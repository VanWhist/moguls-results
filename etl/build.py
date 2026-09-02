"""ETL entry point: python -m etl.build [--accept-rounds] [--accept-revision] [--fis] [--no-parser-b] [--filter SUBSTR]

Reads every in-scope result PDF, verifies with the multi-layer checks, and writes data/ (content-hashed
files + manifest.json). Rounds that fail any layer are excluded together with their whole event.
"""
import os, sys, json, hashlib, argparse, datetime, collections, shutil
sys.stdout.reconfigure(encoding='utf-8')
from decimal import Decimal
from . import config, verify, normalize, scoring
from .parsers import parser_a

try:
    from .parsers import parser_b
except Exception as e:  # pragma: no cover
    parser_b = None
    PARSER_B_ERROR = repr(e)
else:
    PARSER_B_ERROR = None

BUILD_VERSION = '1.0'


def load_json(path, default):
    if os.path.exists(path):
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    return default


def dump_json(path, obj):
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(',', ':'))


def content_hash(obj):
    s = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(s).hexdigest()[:8]


def rules_for(cls, rulesets):
    v = cls['season']
    if v not in rulesets['versions']:
        raise KeyError(f"規則版 {v} が rulesets.json に無い（26/27 などは改定後に追加する）")
    return rulesets['versions'][v], v


def group_events(classified):
    """Group rounds into events. Same season/series/venue normally = one event, even when the
    qualification has its own codex far from the finals' (Alpe d'Huez 2023: Q 8787, F1/F2 8159).
    Two events at one venue in one season (Ruka 2025-26: 8122/8949) are told apart because the
    same gender+round would otherwise appear twice; such files start a second cluster."""
    groups = collections.defaultdict(list)
    for c in classified:
        groups[(c['season'], c['series'], c['venue_key'])].append(c)
    events = {}
    for key, items in groups.items():
        items = sorted(items, key=lambda c: (int(c['codex']) if c['codex'] else 0, c['gender'], c['round']))
        clusters = []  # each: {'codices': set, 'slots': set of (gender, round), 'items': []}
        for c in items:
            slot = (c['gender'], c['round'])
            home = None
            for cl in clusters:
                if slot not in cl['slots']:
                    home = cl
                    break
            if home is None:
                home = {'codices': set(), 'slots': set(), 'items': []}
                clusters.append(home)
            home['slots'].add(slot)
            if c['codex']:
                home['codices'].add(int(c['codex']))
            home['items'].append(c)
        for cl in clusters:
            base = min(cl['codices']) if cl['codices'] else 'owg'
            eid = f"{key[0]}-{config.slug(key[2])}-{base}"
            for c in cl['items']:
                c['event_id'] = eid
            events.setdefault(eid, {'event_id': eid, 'season': key[0], 'series': key[1], 'format': cl['items'][0]['format'],
                                    'venue_key': key[2], 'rounds': []})
    return events


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--accept-rounds', action='store_true', help='新しいラウンドの人数を基準として登録する')
    ap.add_argument('--accept-revision', action='store_true', help='元PDFの変更（公式改訂）を受け入れて基準ハッシュを更新する')
    ap.add_argument('--fis', action='store_true', help='第5層: FIS サイトとの外部照合を行う（ネットワーク必要）')
    ap.add_argument('--fis-filter', default=None, help='第5層の対象を event_id にこの文字列を含む大会に限定（例: 2026-27）。それ以外は前回の結果を使う')
    ap.add_argument('--no-parser-b', action='store_true')
    ap.add_argument('--filter', default=None, help='パスにこの文字列を含む PDF だけ処理（開発用。公開ゲートは無効）')
    args = ap.parse_args(argv)

    rulesets = load_json(os.path.join(config.RULES_DIR, 'rulesets.json'), None)
    dd_tables = {}
    for v in rulesets['versions'].values():
        if v.get('dd_table') and v['dd_table'] not in dd_tables:
            dd_tables[v['dd_table']] = load_json(os.path.join(config.RULES_DIR, v['dd_table'] + '.json'), None)
    expected = load_json(config.EXPECTED_ROUNDS, {})
    published = load_json(config.PUBLISHED_HASHES, {})
    aliases = load_json(config.ATHLETE_ALIASES, {})
    imported_at = datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S')

    classified = config.list_source_pdfs()
    if args.filter:
        classified = [c for c in classified if args.filter in c['path']]
    events = group_events(classified)
    print(f"対象 PDF: {len(classified)} 件 / 大会 {len(events)} 件")

    findings = []
    rounds_ctx = []
    dd_seen = collections.defaultdict(set)
    for c in classified:
        rules, rules_version = rules_for(c, rulesets)
        try:
            meta_a, recs_a = parser_a.parse_moguls_results(c['path'])
        except Exception as e:
            findings.append(verify.Finding('error', c['rel'], 'layer0', f"パーサ A 例外: {e!r}"))
            continue
        # A '予選' file that carries Q1/Q2 blocks is the Qualification-2 report of a two-round qualification.
        if meta_a.get('q_layout') and c['round'] == 'Q':
            c['round'] = 'Q2'
        rnd, runs = normalize.make_round(c, meta_a, recs_a, rules, rules_version, c['event_id'], imported_at)
        ctx = {'cls': c, 'round': rnd, 'runs': runs, 'records_a': recs_a, 'meta_a': meta_a, 'rules': rules}
        # layer 1
        if not args.no_parser_b:
            if parser_b is None:
                findings.append(verify.Finding('error', rnd['round_id'], 'layer1', f"パーサ B を読み込めない: {PARSER_B_ERROR}"))
            else:
                try:
                    meta_b, recs_b = parser_b.parse_moguls_results(c['path'])
                except Exception as e:
                    findings.append(verify.Finding('error', rnd['round_id'], 'layer1', f"パーサ B 例外: {e!r}"))
                else:
                    findings += verify.layer1(rnd['round_id'], recs_a, recs_b, meta_a, meta_b)
                    ctx['ab_compared'] = True
        # layer 2
        dd_table = dd_tables.get(rules.get('dd_table')) if rules.get('dd_table') else None
        findings += verify.layer2(rnd['round_id'], runs, dd_table, rnd['gender'], dd_seen)
        # layer 3 (rank)
        findings += verify.layer3_rank(rnd['round_id'], runs, rules)
        rounds_ctx.append(ctx)
        print(f"  読込 {rnd['round_id']:28s} {c['gender']} {c['round']:3s} {len(runs):3d} records")

    findings += verify.layer0(rounds_ctx, expected, args.accept_rounds, check_missing=not args.filter)
    # executed-count gate (checks_executed == checks_expected): every round must have been compared A/B
    n_ab = sum(1 for ctx in rounds_ctx if ctx.get('ab_compared'))
    if not args.no_parser_b and n_ab != len(rounds_ctx):
        findings.append(verify.Finding('error', 'global', 'layer1', f"2方式比較が実行されたラウンド {n_ab}/{len(rounds_ctx)}"))
    findings += verify.dd_consistency(dd_seen)
    # layer 3 (progression) per event & gender
    for ev in events.values():
        for gender in ('M', 'W'):
            rbc = {ctx['round']['round']: (ctx['round'], ctx['runs']) for ctx in rounds_ctx
                   if ctx['round']['event_id'] == ev['event_id'] and ctx['round']['gender'] == gender}
            if rbc:
                findings += verify.layer3_progression(ev, rbc, rulesets['formats'][ev['format']])
    all_runs = [r for ctx in rounds_ctx for r in ctx['runs']]
    all_rounds = [ctx['round'] for ctx in rounds_ctx]
    findings += verify.layer4(all_runs, all_rounds)
    # FIS attachment URLs found by an earlier --fis run are cached so that builds without network keep them
    fis_urls = load_json(config.FIS_URLS, {})
    for ctx in rounds_ctx:
        rid = ctx['round']['round_id']
        if fis_urls.get(rid):
            ctx['round']['source']['fis_url'] = fis_urls[rid]
    # layer 5 (optional)
    layer5_status = 'skipped'
    layer5_stats = {}
    layer5_cache = load_json(config.LAYER5_CACHE, {})
    if args.fis:
        try:
            from . import layer5
            targets = [ctx for ctx in rounds_ctx if not args.fis_filter or args.fis_filter in ctx['round']['event_id']]
            findings += layer5.cross_check(targets, known_gaps=load_json(config.KNOWN_GAPS, {}), stats=layer5_stats)
            fresh = layer5_stats.get('round_status', {})
            layer5_cache.update({k: v for k, v in fresh.items() if v != 'error'})
            dump_json(config.LAYER5_CACHE, layer5_cache)
            # rounds outside the filter keep their recorded status; anything never checked counts as missing
            merged = {ctx['round']['round_id']: fresh.get(ctx['round']['round_id'], layer5_cache.get(ctx['round']['round_id'], 'error')) for ctx in rounds_ctx}
            layer5_stats['round_status'] = merged
            n_missing = sum(1 for v in merged.values() if v == 'error')
            layer5_status = 'ok' if layer5_stats.get('groups_checked') == layer5_stats.get('groups_expected') and n_missing == 0 else 'error'
            if n_missing:
                findings.append(verify.Finding('warning', 'global', 'layer5', f"第5層の結果が無いラウンド {n_missing} 件（--fis-filter の外で未照合）"))
            for ctx in rounds_ctx:
                if ctx['round']['source'].get('fis_url'):
                    fis_urls[ctx['round']['round_id']] = ctx['round']['source']['fis_url']
            dump_json(config.FIS_URLS, fis_urls)
        except Exception as e:
            findings.append(verify.Finding('warning', 'global', 'layer5', f"外部照合を実行できない: {e!r}"))
    # golden
    runs_by_id = {r['run_id']: r for r in all_runs}
    gres = verify.golden(config.GOLDEN_DIR, runs_by_id, strict=not args.filter)
    if isinstance(gres, tuple):
        gf, n_golden = gres
        findings += gf
    else:
        n_golden = 0

    # ---------------- publication gate
    errors_by_round = collections.defaultdict(list)
    for fd in findings:
        if fd.level == 'error':
            errors_by_round[fd.round_id].append(fd)
    bad_events = set()
    for ctx in rounds_ctx:
        if errors_by_round.get(ctx['round']['round_id']) or errors_by_round.get(ctx['round']['event_id']):
            bad_events.add(ctx['round']['event_id'])
    global_errors = errors_by_round.get('global', [])
    for ctx in rounds_ctx:
        rid = ctx['round']['round_id']
        v = {}
        for layer in verify.LAYERS:
            errs = [x for x in errors_by_round.get(rid, []) if x.layer == layer]
            v[layer] = 'error' if errs else ('skipped' if layer == 'layer5' and layer5_status == 'skipped' else 'ok')
        if args.fis and v['layer5'] != 'error':
            v['layer5'] = layer5_stats.get('round_status', {}).get(rid, 'error')  # never green by default
        # a layer-5 error found at event level (round_id == event_id) also blocks the round
        if any(x.layer == 'layer5' for x in errors_by_round.get(ctx['round']['event_id'], [])):
            v['layer5'] = 'error'
        if n_golden == 0 and v['golden'] == 'ok':
            v['golden'] = 'skipped'
        ctx['round']['verification'] = v

    # published-hash / PDF revision check
    for ctx in rounds_ctx:
        rid = ctx['round']['round_id']
        pdf_hash = ctx['round']['source']['pdf_sha256']
        prev = published.get(rid)
        if prev and prev['pdf_sha256'] != pdf_hash:
            if args.accept_revision:
                findings.append(verify.Finding('warning', rid, 'gate', '元 PDF が改訂された（受け入れ）'))
            else:
                findings.append(verify.Finding('error', rid, 'gate', '公開済みラウンドの元 PDF が変わった。内容確認後 `--accept-revision`'))
                bad_events.add(ctx['round']['event_id'])

    publish_ctx = [ctx for ctx in rounds_ctx if ctx['round']['event_id'] not in bad_events]
    if global_errors:
        print(f"!! 全体エラー {len(global_errors)} 件のため公開データを更新しません")
    write_report(findings, rounds_ctx, bad_events, n_golden, layer5_status)
    n_err = sum(1 for x in findings if x.level == 'error')
    n_warn = sum(1 for x in findings if x.level == 'warning')
    print(f"\n{len(all_runs)} records / {n_warn} warnings / {n_err} errors / 公開対象 {len(publish_ctx)}/{len(rounds_ctx)} ラウンド")

    if args.accept_rounds:
        dump_json(config.EXPECTED_ROUNDS, expected)
    if global_errors or args.filter:
        if args.filter:
            print("(--filter 指定のため data/ は更新しません)")
        return 1 if (global_errors or n_err) else 0

    counts = {'runs_parsed': len(all_runs), 'rounds_parsed': len(rounds_ctx),
              'runs_ab_compared': sum(len(ctx['runs']) for ctx in rounds_ctx if ctx.get('ab_compared')),
              'runs_recomputed': sum(1 for r in all_runs if r['status'] == 'OK'),
              'rounds_ranked': len(rounds_ctx),
              'events_html_checked': layer5_stats.get('groups_checked', 0), 'events_html_expected': layer5_stats.get('groups_expected', 0),
              'golden_runs': n_golden, 'mutations': 12}
    write_data(publish_ctx, events, rulesets, aliases, imported_at, n_golden, layer5_status, findings, counts)
    # record hashes of what was published
    for ctx in publish_ctx:
        rid = ctx['round']['round_id']
        published[rid] = {'pdf_sha256': ctx['round']['source']['pdf_sha256'],
                          'runs_hash': content_hash([strip_private(r) for r in ctx['runs']])}
    dump_json(config.PUBLISHED_HASHES, published)
    return 0 if n_err == 0 else 1


def strip_private(run):
    return {k: v for k, v in run.items() if not k.startswith('_')}


def write_report(findings, rounds_ctx, bad_events, n_golden, layer5_status):
    os.makedirs(config.DOCS_DIR, exist_ok=True)
    lines = [f"# 検証レポート", f"", f"生成: {datetime.datetime.now():%Y-%m-%d %H:%M}", "",
             f"ラウンド {len(rounds_ctx)} 件 / 記録 {sum(len(c['runs']) for c in rounds_ctx)} 本 / 正解データ {n_golden} 本 / 第5層: {layer5_status}", ""]
    errs = [f for f in findings if f.level == 'error']
    warns = [f for f in findings if f.level == 'warning']
    lines += [f"## エラー（{len(errs)} 件）", ""]
    for f in errs:
        lines.append(f"- [{f.layer}] {f.round_id}: {f.message}")
    lines += ["", f"## 警告（{len(warns)} 件）", ""]
    for f in warns:
        lines.append(f"- [{f.layer}] {f.round_id}: {f.message}")
    lines += ["", "## ラウンド別", "", "| round_id | 記録 | " + " | ".join(verify.LAYERS) + " | 公開 |", "|" + "---|" * (len(verify.LAYERS) + 3)]
    for ctx in rounds_ctx:
        r = ctx['round']
        pub = '×' if r['event_id'] in bad_events else '○'
        lines.append(f"| {r['round_id']} | {len(ctx['runs'])} | " + " | ".join(r['verification'].get(l, '-') for l in verify.LAYERS) + f" | {pub} |")
    with open(os.path.join(config.DOCS_DIR, '検証レポート.md'), 'w', encoding='utf-8') as fh:
        fh.write("\n".join(lines) + "\n")


def cut_label(fmt, round_code):
    adv = fmt['advance'].get(round_code)
    if not adv:
        return None
    to = adv['to']
    if adv.get('best_of'):
        n = adv['n'] + fmt['advance'].get('Q1', {}).get('n', 0)
    else:
        n = adv['n']
    return {'rank': n, 'to': to, 'label': f"{to} 進出ライン（{n}位）"}


def write_data(publish_ctx, events, rulesets, aliases, imported_at, n_golden, layer5_status, findings, counts=None):
    os.makedirs(config.DATA_DIR, exist_ok=True)
    # remove previously generated hashed files (keep sample/ and manifest until rewritten)
    for fn in os.listdir(config.DATA_DIR):
        p = os.path.join(config.DATA_DIR, fn)
        if os.path.isfile(p) and fn != 'manifest.json' and '.' in fn and fn.rsplit('.', 1)[-1] == 'json':
            os.remove(p)

    ev_out = {}
    for ctx in publish_ctx:
        r = ctx['round']
        ev = events[r['event_id']]
        e = ev_out.setdefault(r['event_id'], {'event_id': r['event_id'], 'season': ev['season'], 'series': ev['series'],
                                              'format': ev['format'], 'format_label': rulesets['formats'][ev['format']]['label'],
                                              'venue': r['venue'], 'venue_key': ev['venue_key'], 'rounds': []})
        e['rounds'].append({k: v for k, v in r.items()})
        e['known_gaps'] = {k: v for k, v in load_json(config.KNOWN_GAPS, {}).get(r['event_id'], {}).items() if not k.startswith('_')}
    for e in ev_out.values():
        e['rounds'].sort(key=lambda r: (r['gender'], ['Q', 'Q1', 'Q2', 'F1', 'F2', 'F3'].index(r['round'])))
        e['date_from'] = min((r['date'] for r in e['rounds'] if r['date']), default=None)
        e['date_to'] = max((r['date'] for r in e['rounds'] if r['date']), default=None)
        e['nation'] = (e['venue'] or '')[-4:-1] if e['venue'] and e['venue'].endswith(')') else None
    events_list = sorted(ev_out.values(), key=lambda e: (e['date_from'] or '', e['event_id']), reverse=True)

    runs_by_season = collections.defaultdict(list)
    all_runs = []
    for ctx in publish_ctx:
        for run in ctx['runs']:
            pub = strip_private(run)
            runs_by_season[run['season']].append(pub)
            all_runs.append(pub)

    # lines: winner and cut per round
    lines = []
    for ctx in publish_ctx:
        r = ctx['round']
        fmt = rulesets['formats'][r['format']]
        ok = [x for x in ctx['runs'] if x['status'] == 'OK' and x['counting'] and x['rank']]
        ok.sort(key=lambda x: x['rank'])
        if not ok:
            continue
        cl = cut_label(fmt, r['round'])
        entry = {'round_id': r['round_id'], 'winner': run_summary(ok[0]), 'cut': None, 'n_ok': len(ok)}
        if cl:
            cut_run = next((x for x in ok if x['rank'] == cl['rank']), None)
            if cut_run is None and ok:
                cut_run = max([x for x in ok if x['rank'] <= cl['rank']] or [ok[-1]], key=lambda x: x['rank'])
            entry['cut'] = {'rank': cl['rank'], 'label': cl['label'], 'to': cl['to'], 'run': run_summary(cut_run)}
        lines.append(entry)

    # athletes
    by_code = collections.defaultdict(list)
    for run in all_runs:
        by_code[run['fis_code']].append(run)
    athletes = []
    for code, rs in by_code.items():
        rs_sorted = sorted(rs, key=lambda x: x['date'] or '')
        names = collections.Counter(x['name'] for x in rs)
        name = names.most_common(1)[0][0]
        noc_hist = []
        for x in rs_sorted:
            if not noc_hist or noc_hist[-1]['noc'] != x['noc']:
                noc_hist.append({'noc': x['noc'], 'from': x['season'], 'to': x['season']})
            else:
                noc_hist[-1]['to'] = x['season']
        al = aliases.get(code, {})
        alias_list = [n for n in names if n != name] + [al.get('kana')] + al.get('kanji', [])
        best = max([x for x in rs if x['run_score'] is not None], key=lambda x: x['run_score'], default=None)
        athletes.append({'athlete_id': code, 'fis_code': code, 'name': name, 'aliases': [a for a in alias_list if a],
                         'noc': rs_sorted[-1]['noc'], 'noc_history': noc_hist, 'yb': rs_sorted[-1]['yb'],
                         'n_runs': sum(1 for x in rs if x['counting']), 'seasons': sorted({x['season'] for x in rs}),
                         'best': {'run_score': best['run_score'], 'run_id': best['run_id']} if best else None})
    athletes.sort(key=lambda a: a['name'])

    # judges master (no screen in Phase 1)
    judges = {}
    for ctx in publish_ctx:
        r = ctx['round']
        for j in r['judges']:
            e = judges.setdefault(j['judge_id'], {'judge_id': j['judge_id'], 'name': j['name'], 'noc': j['noc'], 'rounds': []})
            e['rounds'].append({'round_id': r['round_id'], 'no': j['no'], 'role': j['role']})
    judges_list = sorted(judges.values(), key=lambda j: j['name'])

    rules_out = {'versions': rulesets['versions'], 'formats': rulesets['formats']}

    files = {}
    def emit(name, obj):
        h = content_hash(obj)
        fn = f"{name}.{h}.json"
        dump_json(os.path.join(config.DATA_DIR, fn), obj)
        return fn
    files['events'] = emit('events', events_list)
    files['athletes'] = emit('athletes', athletes)
    files['lines'] = emit('lines', lines)
    files['judges'] = emit('judges', judges_list)
    files['rules'] = emit('rules', rules_out)
    files['runs'] = {season: emit(f'runs.{season}', rs) for season, rs in sorted(runs_by_season.items())}

    manifest = {
        'dataVersion': datetime.datetime.now().strftime('%Y-%m-%d-%H%M'), 'builtAt': imported_at,
        'buildVersion': BUILD_VERSION, 'parserVersion': parser_a.PARSER_VERSION,
        'files': files,
        'counts': {'events': len(events_list), 'rounds': len(publish_ctx), 'runs': len(all_runs), 'athletes': len(athletes)},
        'seasons': sorted(runs_by_season.keys()),
        'verification': {'allGreen': all(all(v in ('ok', 'skipped', 'upstream_missing') for v in c['round']['verification'].values()) for c in publish_ctx),
                         'layers': {'layer0': '完全性（大会・ラウンド・人数）', 'layer1': '2方式の読み取り一致', 'layer2': 'FIS規則からの再計算一致',
                                    'layer3': '順位・進出条件の再構成', 'layer4': '大会横断の整合', 'layer5': 'FIS公式Web結果との照合', 'golden': '目視正解データとの一致'},
                         'goldenRuns': n_golden, 'layer5': layer5_status, 'counts': counts or {},
                         'warnings': sum(1 for f in findings if f.level == 'warning'),
                         'reportPath': 'docs/検証レポート.md'},
    }
    dump_json(os.path.join(config.DATA_DIR, 'manifest.json'), manifest)
    print(f"data/ を書き出しました: events {len(events_list)} / rounds {len(publish_ctx)} / runs {len(all_runs)} / athletes {len(athletes)} / dataVersion {manifest['dataVersion']}")


def run_summary(run):
    return {'run_id': run['run_id'], 'fis_code': run['fis_code'], 'name': run['name'], 'noc': run['noc'], 'rank': run['rank'],
            'run_score': run['run_score'], 'time_points': run['time_points'], 'seconds': run['seconds'], 'air_total': run['air_total'],
            'turns_total': run['turns_total'], 'base_total': run['base_total'], 'ded_total': run['ded_total'],
            'air': [{'jump': a['jump'], 'dd': a['dd'], 'jump_score': a['jump_score']} for a in run['air']]}


if __name__ == '__main__':
    sys.exit(main())
