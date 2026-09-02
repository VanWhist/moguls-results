"""多層照合 (multi-layer verification).

Each layer returns a list of Finding(level, round_id, layer, message). level is 'error' or 'warning'.
A round with any error is not published (all-or-nothing per event).
"""
import json, os, collections
from decimal import Decimal
from . import scoring
from .config import EXPECTED_ROUNDS

LAYERS = ['layer0', 'layer1', 'layer2', 'layer3', 'layer4', 'layer5', 'golden']


class Finding:
    def __init__(self, level, round_id, layer, message):
        self.level, self.round_id, self.layer, self.message = level, round_id, layer, message

    def as_dict(self):
        return {'level': self.level, 'round_id': self.round_id, 'layer': self.layer, 'message': self.message}


def _num_eq(a, b, tol=Decimal('0.005')):
    if a is None or b is None:
        return a is None and b is None
    return abs(Decimal(str(a)) - Decimal(str(b))) <= tol


# ---------------------------------------------------------------- layer 0: completeness
def layer0(rounds_ctx, expected, accept_rounds, check_missing=True):
    """rounds_ctx: list of dicts {round, runs, records_a, cls}. expected: dict key -> n_competitors."""
    f = []
    seen_ids = set()
    for ctx in rounds_ctx:
        r = ctx['round']
        key = f"{r['season']}|{r['codex']}|{r['gender']}|{r['round']}"
        n_ath = len({x['fis_code'] for x in ctx['records_a']})
        if r['n_competitors'] is None:
            f.append(Finding('error', r['round_id'], 'layer0', 'PDF に Number of Competitors が無い'))
        elif r['n_competitors'] != n_ath:
            f.append(Finding('error', r['round_id'], 'layer0', f"出走数 {r['n_competitors']} に対し抽出 {n_ath} 名"))
        if key not in expected:
            if accept_rounds:
                expected[key] = n_ath
            f.append(Finding('warning', r['round_id'], 'layer0',
                             f"新しいラウンド（{n_ath} 名）。内容確認後 `--accept-rounds` で基準に登録" if not accept_rounds
                             else f"新しいラウンドを基準に登録（{n_ath} 名）"))
        elif expected[key] != n_ath:
            f.append(Finding('error', r['round_id'], 'layer0', f"登録済み基準 {expected[key]} 名と一致しない（今回 {n_ath} 名）"))
        for run in ctx['runs']:
            if run['run_id'] in seen_ids:
                f.append(Finding('error', r['round_id'], 'layer0', f"run_id 重複: {run['run_id']}"))
            seen_ids.add(run['run_id'])
        if r['pace_time'] is None:
            f.append(Finding('error', r['round_id'], 'layer0', 'ペースタイムが読めない'))
        if len(r['judges']) != 7:
            f.append(Finding('warning', r['round_id'], 'layer0', f"審判が {len(r['judges'])} 名（7名想定）"))
    # expected rounds that disappeared
    present = {f"{c['round']['season']}|{c['round']['codex']}|{c['round']['gender']}|{c['round']['round']}" for c in rounds_ctx}
    for key in (expected if check_missing else []):
        if key not in present:
            f.append(Finding('error', key, 'layer0', '基準に登録済みのラウンドが今回の取り込みに無い（PDF が消えた？）'))
    return f


# ---------------------------------------------------------------- layer 1: two parsers agree
FIELDS_REC = ['rank', 'bib', 'fis_code', 'name', 'noc', 'yb', 'status', 'reserve_judge', 'seconds', 'time_points',
              'air_total', 'base_total', 'ded_total', 'turns_total', 'run_score', 'tie', 'q_block', 'best_score', 'counting']


def _rec_key(rec):
    return (rec['fis_code'], rec.get('q_block'), bool(rec.get('counting')))


def layer1(round_id, recs_a, recs_b, meta_a, meta_b):
    f = []
    if recs_b is None:
        f.append(Finding('error', round_id, 'layer1', 'パーサ B が利用できない'))
        return f
    da = {_rec_key(r): r for r in recs_a}
    db = {_rec_key(r): r for r in recs_b}
    for k in da.keys() - db.keys():
        f.append(Finding('error', round_id, 'layer1', f"B に無い記録: {k}"))
    for k in db.keys() - da.keys():
        f.append(Finding('error', round_id, 'layer1', f"A に無い記録: {k}"))
    for k in da.keys() & db.keys():
        a, b = da[k], db[k]
        for fld in FIELDS_REC:
            va, vb = a.get(fld), b.get(fld)
            same = _num_eq(va, vb) if isinstance(va, (int, float)) and not isinstance(va, bool) and isinstance(vb, (int, float)) else (va == vb)
            if not same:
                f.append(Finding('error', round_id, 'layer1', f"{a['name']} {k[1] or ''} {fld}: A={va} B={vb}"))
        for fld in ('base_scores', 'ded_scores'):
            if [x for x in a.get(fld, [])] != [x for x in b.get(fld, [])]:
                f.append(Finding('error', round_id, 'layer1', f"{a['name']} {fld}: A={a.get(fld)} B={b.get(fld)}"))
        ja, jb = a.get('air_jumps', []), b.get('air_jumps', [])
        if len(ja) != len(jb) or any(x != y for x, y in zip(ja, jb)):
            f.append(Finding('error', round_id, 'layer1', f"{a['name']} air_jumps: A={ja} B={jb}"))
    for fld in ('num_competitors', 'pace_time', 'codex', 'date', 'event'):
        if meta_a.get(fld) != meta_b.get(fld):
            f.append(Finding('error', round_id, 'layer1', f"meta {fld}: A={meta_a.get(fld)} B={meta_b.get(fld)}"))
    ja = [(j['judge_no'], j['name'], j['noc']) for j in meta_a.get('judges', [])]
    jb = [(j['judge_no'], j['name'], j['noc']) for j in meta_b.get('judges', [])]
    if ja != jb:
        f.append(Finding('error', round_id, 'layer1', f"judges: A={ja} B={jb}"))
    return f


# ---------------------------------------------------------------- layer 2: recomputation
def layer2(round_id, runs, dd_table, gender, dd_seen):
    f = []
    for run in runs:
        if run['status'] != 'OK':
            continue
        p, rc = run['_printed'], run['_recomputed']
        for fld, val in (('time_points', rc['time_points']), ('air_total', rc['air_total']), ('base_total', rc['base_total']),
                         ('ded_total', rc['ded_total']), ('turns_total', rc['turns_total']), ('run_score', rc['run_score'])):
            if val is None:
                continue
            if not _num_eq(p.get(fld), val):
                f.append(Finding('error', round_id, 'layer2', f"{run['name']} {run.get('q_block') or ''} {fld}: 印字 {p.get(fld)} / 再計算 {val}"))
        if run['q_block'] and run['counting'] and run['best_score'] is not None:
            pass  # checked in layer3 (best-of)
        for j in run['air']:
            dd_seen[(run['season'], gender, j['jump'])].add(j['dd'])
            if dd_table and j['jump'] in dd_table.get(gender, {}):
                if not _num_eq(j['dd'], dd_table[gender][j['jump']]):
                    f.append(Finding('warning', round_id, 'layer2',
                                     f"{run['name']} ジャンプ {j['jump']} の DD {j['dd']} が DD 表 {dd_table[gender][j['jump']]} と違う（同カテゴリ2本の低い方適用 ICR 4210.2.2 の可能性）"))
    return f


def dd_consistency(dd_seen):
    f = []
    for (season, gender, code), dds in sorted(dd_seen.items()):
        if len(dds) > 1:
            f.append(Finding('warning', f"{season}", 'layer2', f"{gender} ジャンプ {code} の DD がシーズン内で複数 {sorted(dds)}（ICR 4210.2.2 の調整か、誤読）"))
    return f


# ---------------------------------------------------------------- layer 3: ranks & progression
def _athlete_items(runs):
    """Group a round's runs by athlete. Returns list of dicts {fis_code, name, rank (printed), direct, best_run}
    where best_run is the OK block with the highest run score (None if every block is a status)."""
    by = collections.OrderedDict()
    for r in runs:
        by.setdefault(r['fis_code'], []).append(r)
    items = []
    for code, blocks in by.items():
        ok = [b for b in blocks if b['status'] == 'OK' and b['run_score'] is not None]
        best = max(ok, key=lambda b: Decimal(str(b['run_score']))) if ok else None
        direct = all(b['q_block'] == 'Q1' for b in blocks) and any(b['q_block'] for b in blocks)
        items.append({'fis_code': code, 'name': blocks[0]['name'], 'rank': blocks[0]['rank'], 'direct': direct,
                      'best_run': best, 'blocks': blocks, 'best_score': blocks[0].get('best_score')})
    return items


def _rank_items(items, rules):
    recs = []
    for it in items:
        b = it['best_run']
        rc = b['_recomputed']
        recs.append({'item': it, 'run_score': rc['run_score'], 'turns_total': rc['turns_total'],
                     'air_without_dd': rc['air_without_dd'], 'seconds': Decimal(str(b['seconds']))})
    return scoring.rank_order(recs, rules)


def layer3_rank(round_id, runs, rules):
    f = []
    items = [it for it in _athlete_items(runs) if it['best_run'] is not None]
    if not items:
        return f
    q_layout = any(r['q_block'] for r in runs)
    if q_layout:
        for it in items:
            best = Decimal(str(it['best_run']['run_score']))
            if it['best_score'] is None or not _num_eq(it['best_score'], best):
                f.append(Finding('error', round_id, 'layer3', f"{it['name']} 採用点 {it['best_score']} がブロック最高点 {best} と違う"))
    # Q2 reports that list the Q1 direct qualifiers rank them first (by their Q1 run), then everyone else by best score.
    groups = [[it for it in items if it['direct']], [it for it in items if not it['direct']]] if q_layout else [items]
    offset = 0
    for grp in groups:
        if not grp:
            continue
        for rec, rank in _rank_items(grp, rules):
            it = rec['item']
            if it['rank'] != rank + offset:
                f.append(Finding('error', round_id, 'layer3', f"{it['name']} 順位 印字 {it['rank']} / 再構成 {rank + offset}"))
        offset += len(grp)
    return f


def _cut(items_ranked, n):
    """Athletes that go forward: printed rank <= n, plus everyone tied with the n-th (ICR 4007.3)."""
    ranked = sorted([it for it in items_ranked if it['rank']], key=lambda it: it['rank'])
    if not ranked:
        return []
    if len(ranked) >= n:
        nth = ranked[n - 1]['rank']
        return [it for it in ranked if it['rank'] <= nth]
    return ranked


def layer3_progression(event, rounds_by_code, fmt):
    """Check that each round's field is exactly the qualifiers of the previous round(s)."""
    f = []
    adv = fmt['advance']
    codes = rounds_by_code
    items = {code: _athlete_items(runs) for code, (rnd, runs) in codes.items()}

    def expected_for(to):
        """Return (expected set of fis codes, list of source round codes, description)."""
        if to == 'F1':
            n1 = adv.get('Q1', {}).get('n', 0)
            n2 = adv.get('Q2', {}).get('n', 0)
            if 'Q2' in codes:
                q2 = items['Q2']
                if any(it['direct'] for it in q2):
                    exp = {it['fis_code'] for it in _cut(q2, n1 + n2)}
                    return exp, ['Q2'], f"Q2 報告の上位 {n1 + n2}"
                exp = {it['fis_code'] for it in _cut(q2, n2)}
                srcs = ['Q2']
                if 'Q1' in codes:
                    exp |= {it['fis_code'] for it in _cut(items['Q1'], n1)}
                    srcs.append('Q1')
                return exp, srcs, f"Q1 上位 {n1} ＋ Q2 上位 {n2}"
            if 'Q' in codes:
                n = adv.get('Q', {}).get('n') or (n1 + n2)
                return {it['fis_code'] for it in _cut(items['Q'], n)}, ['Q'], f"Q 上位 {n}"
            if 'Q1' in codes:
                return {it['fis_code'] for it in _cut(items['Q1'], n1)}, ['Q1'], f"Q1 上位 {n1}"
            return None, [], ''
        prev = {'F2': 'F1', 'F3': 'F2'}[to]
        if prev not in codes:
            return None, [], ''
        n = adv.get(prev, {}).get('n')
        if not n:
            return None, [], ''
        return {it['fis_code'] for it in _cut(items[prev], n)}, [prev], f"{prev} 上位 {n}"

    for to in ('F1', 'F2', 'F3'):
        if to not in codes:
            continue
        exp, srcs, desc = expected_for(to)
        if exp is None:
            continue
        rnd_to, runs_to = codes[to]
        present = {it['fis_code']: it for it in items[to]}
        in_sources = {it['fis_code']: (code, it) for code in srcs for it in items[code]}
        missing = [c for c in exp if c not in present]
        for c in missing:
            src_code, it = in_sources[c]
            f.append(Finding('warning', rnd_to['round_id'], 'layer3', f"{src_code} {it['rank']}位 {it['name']} が {to} に居ない（欠場？）"))
        for c, it in present.items():
            if c in exp:
                continue
            if c in in_sources:
                src_code, src = in_sources[c]
                f.append(Finding('error', rnd_to['round_id'], 'layer3', f"{to} の {it['name']} は {src_code} {src['rank']}位で通過枠（{desc}）の外"))
            else:
                f.append(Finding('warning', rnd_to['round_id'], 'layer3', f"{to} の {it['name']} は {'/'.join(srcs)} に出走していない（シード直接進出？）"))
        if len(present) != len(exp) and not missing:
            f.append(Finding('warning', rnd_to['round_id'], 'layer3', f"{to} の人数 {len(present)} が通過枠 {len(exp)}（{desc}）と違う"))
    return f


# ---------------------------------------------------------------- layer 4: cross-file consistency
def layer4(all_runs, rounds):
    f = []
    by_code = collections.defaultdict(list)
    for r in all_runs:
        by_code[r['fis_code']].append(r)
    for code, rs in by_code.items():
        ybs = {r['yb'] for r in rs if r['yb']}
        if len(ybs) > 1:
            f.append(Finding('error', 'global', 'layer4', f"FIS {code} の生年が複数 {sorted(ybs)}: {sorted({r['name'] for r in rs})}"))
        names = {r['name'] for r in rs}
        if len(names) > 1:
            f.append(Finding('warning', 'global', 'layer4', f"FIS {code} の氏名表記が複数 {sorted(names)}（別名として扱う）"))
        nocs = {r['noc'] for r in rs}
        if len(nocs) > 1:
            f.append(Finding('warning', 'global', 'layer4', f"FIS {code} {sorted(names)[0]} の国が複数 {sorted(nocs)}（履歴として扱う）"))
    by_name = collections.defaultdict(set)
    for r in all_runs:
        by_name[(r['name'], r['yb'])].add(r['fis_code'])
    for (name, yb), codes in by_name.items():
        if len(codes) > 1:
            # can be legitimate (siblings whose long surname pushes the first name off the PDF: GERKEN SCHOFIELD 1998 GBR)
            f.append(Finding('warning', 'global', 'layer4', f"同じ氏名・生年 {name} {yb} に FIS コードが複数 {sorted(codes)}（別人か確認）"))
    # same event: judges and pace time across rounds of the same gender
    by_event = collections.defaultdict(list)
    for r in rounds:
        by_event[(r['event_id'], r['gender'])].append(r)
    for key, rs in by_event.items():
        paces = {r['pace_time'] for r in rs}
        if len(paces) > 1:
            f.append(Finding('warning', rs[0]['event_id'], 'layer4', f"{key[1]} ラウンド間でペースタイムが違う {sorted(paces)}"))
        panels = {tuple((j['no'], j['name']) for j in r['judges']) for r in rs}
        if len(panels) > 1:
            f.append(Finding('warning', rs[0]['event_id'], 'layer4', f"{key[1]} ラウンド間で審判構成が違う"))
    return f


# ---------------------------------------------------------------- golden dataset
def golden(golden_dir, runs_by_id, strict=True):
    """strict=False ignores golden runs whose round is not among runs_by_id (used by unit tests)."""
    f = []
    rounds_present = {rid.rsplit('-', 1)[0].replace('-Q1ref', '') for rid in runs_by_id}
    rounds_present = {r['round_id'] for r in runs_by_id.values()}
    if not os.path.isdir(golden_dir):
        return f
    n = 0
    for fn in sorted(os.listdir(golden_dir)):
        if not fn.endswith('.json'):
            continue
        with open(os.path.join(golden_dir, fn), encoding='utf-8') as fh:
            g = json.load(fh)
        for item in g.get('runs', []):
            n += 1
            run = runs_by_id.get(item['run_id'])
            if run is None and not strict and not any(item['run_id'].startswith(r + '-') for r in rounds_present):
                n -= 1
                continue
            if run is None:
                f.append(Finding('error', item['run_id'], 'golden', f"正解データのランが出力に無い ({fn})"))
                continue
            for k, v in item.items():
                if k in ('run_id', 'note'):
                    continue
                actual = run.get(k)
                if k in ('base', 'ded'):
                    same = [float(x) for x in v] == [float(x) for x in actual]
                elif k == 'air':
                    same = [(a['J6'], a['J7'], a['jump'], a['dd']) for a in v] == [(a['J6'], a['J7'], a['jump'], a['dd']) for a in actual]
                elif isinstance(v, (int, float)) and not isinstance(v, bool):
                    same = _num_eq(v, actual)
                else:
                    same = v == actual
                if not same:
                    f.append(Finding('error', item['run_id'], 'golden', f"{k}: 正解 {v} / 出力 {actual} ({fn})"))
    return f, n
