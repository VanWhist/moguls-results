"""変異テスト: 正しいデータをわざと壊し、多層照合のどの層が止めるかを確かめる。

    python -m etl.tests.test_mutations

各変異について「少なくとも1つの層がエラーを出す」ことを要求する。パーサ B の代わりに
「変異前のパーサ A の出力」を第1層の相手として使うので、このテストが確かめているのは
検証ロジックであって、パーサ B の独立性ではない（それは本番ビルドで確かめる）。
"""
import os, sys, copy, json, collections
sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from etl import config, verify, normalize
from etl.parsers import parser_a

RULESETS = json.load(open(os.path.join(config.RULES_DIR, 'rulesets.json'), encoding='utf-8'))
DD = json.load(open(os.path.join(config.RULES_DIR, 'dd_2023-11.json'), encoding='utf-8'))


def load(rel):
    c = config.classify_pdf(os.path.join(config.PDF_ROOT, rel))
    meta, recs = parser_a.parse_moguls_results(c['path'])
    if meta.get('q_layout') and c['round'] == 'Q':
        c['round'] = 'Q2'
    c['event_id'] = 'test-event'
    return c, meta, recs


def run_layers(items, golden_dir=None):
    """items: list of (cls, meta, recs, recs_reference). Returns dict layer -> list of error messages."""
    findings = []
    ctxs = []
    dd_seen = collections.defaultdict(set)
    for c, meta, recs, ref in items:
        rules = RULESETS['versions'][c['season']]
        rnd, runs = normalize.make_round(c, meta, recs, rules, c['season'], c['event_id'], 'test')
        ctx = {'cls': c, 'round': rnd, 'runs': runs, 'records_a': recs, 'meta_a': meta, 'rules': rules}
        findings += verify.layer1(rnd['round_id'], recs, ref, meta, meta)
        findings += verify.layer2(rnd['round_id'], runs, DD, rnd['gender'], dd_seen)
        findings += verify.layer3_rank(rnd['round_id'], runs, rules)
        ctxs.append(ctx)
    expected = {f"{c['round']['season']}|{c['round']['codex']}|{c['round']['gender']}|{c['round']['round']}": c['round']['n_competitors'] for c in ctxs}
    findings += verify.layer0(ctxs, expected, False)
    fmt = RULESETS['formats'][ctxs[0]['cls']['format']]
    rbc = {c['round']['round']: (c['round'], c['runs']) for c in ctxs}
    findings += verify.layer3_progression({'event_id': 'test-event'}, rbc, fmt)
    findings += verify.layer4([r for c in ctxs for r in c['runs']], [c['round'] for c in ctxs])
    if golden_dir:
        gres = verify.golden(golden_dir, {r['run_id']: r for c in ctxs for r in c['runs']}, strict=False)
        if isinstance(gres, tuple):
            findings += gres[0]
    errs = collections.defaultdict(list)
    for f in findings:
        if f.level == 'error':
            errs[f.layer].append(f.message)
    return errs


def main():
    base_q = load('2024-25シーズン/Ruka/Ruka_男子モーグル予選_8105.pdf')
    base_f1 = load('2024-25シーズン/Ruka/Ruka_男子モーグル決勝1_8105.pdf')
    base_f2 = load('2024-25シーズン/Ruka/Ruka_男子モーグル決勝2_8105.pdf')
    base_q2 = load('オリンピック/北京オリンピック2022/北京オリンピック_女子予選2.pdf')
    golden_dir = config.GOLDEN_DIR

    def items_with(mutated, which):
        out = []
        for name, base in (('Q', base_q), ('F1', base_f1), ('F2', base_f2)):
            c, meta, recs = base
            recs_m = mutated if name == which else recs
            out.append((copy.deepcopy(c), copy.deepcopy(meta), copy.deepcopy(recs_m), copy.deepcopy(recs)))
        return out

    def mut(which, fn):
        c, meta, recs = {'Q': base_q, 'F1': base_f1, 'F2': base_f2}[which]
        m = copy.deepcopy(recs)
        fn(m)
        return items_with(m, which)

    def swap_j1_j2(m):
        m[0]['base_scores'][0], m[0]['base_scores'][1] = m[0]['base_scores'][1], m[0]['base_scores'][0]

    def swap_names(m):
        m[0]['name'], m[1]['name'] = m[1]['name'], m[0]['name']

    def fis_digit(m):
        m[0]['fis_code'] = m[0]['fis_code'][:-1] + ('0' if m[0]['fis_code'][-1] != '0' else '1')

    def jump_code(m):
        m[0]['air_jumps'][0]['jump'] = 'bF' if m[0]['air_jumps'][0]['jump'] != 'bF' else '7op'

    def dd_change(m):
        m[0]['air_jumps'][1]['DD'] = round(m[0]['air_jumps'][1]['DD'] + 0.17, 2)

    def time_change(m):
        m[0]['seconds'] = round(m[0]['seconds'] + 0.01, 2)

    def delete_one(m):
        del m[3]

    def duplicate_one(m):
        m.append(copy.deepcopy(m[2]))

    def drop_from_f1(m):
        del m[0]

    def rank_swap(m):
        m[0]['rank'], m[1]['rank'] = m[1]['rank'], m[0]['rank']

    def ded_sign(m):
        m[2]['ded_scores'][2] = -m[2]['ded_scores'][2]

    cases = [
        ('J1/J2 のベース点を入れ替え (F2)', mut('F2', swap_j1_j2)),
        ('選手2名の氏名を入れ替え (F2)', mut('F2', swap_names)),
        ('FIS コード1桁変更 (F1)', mut('F1', fis_digit)),
        ('ジャンプコード変更 (F2)', mut('F2', jump_code)),
        ('DD を +0.17 (F2)', mut('F2', dd_change)),
        ('タイム +0.01 秒 (F2)', mut('F2', time_change)),
        ('選手1名を削除 (Q)', mut('Q', delete_one)),
        ('ラン1本を重複 (Q)', mut('Q', duplicate_one)),
        ('F1 から1名削除', mut('F1', drop_from_f1)),
        ('順位を入れ替え (F2)', mut('F2', rank_swap)),
        ('減点の符号反転 (F2)', mut('F2', ded_sign)),
    ]
    # Q2 mislabel: swap the Q1/Q2 labels of the first athlete in a two-block report
    c, meta, recs = base_q2
    m = copy.deepcopy(recs)
    blocks = [r for r in m if r['fis_code'] == m[0]['fis_code']]
    if len(blocks) == 2:
        blocks[0]['q_block'], blocks[1]['q_block'] = blocks[1]['q_block'], blocks[0]['q_block']
        blocks[0]['counting'], blocks[1]['counting'] = False, True
    cases.append(('Q2 ブロックを Q1 と誤ラベル (北京 W Q2)', [(copy.deepcopy(c), copy.deepcopy(meta), m, copy.deepcopy(recs))]))

    # sanity: unmutated must be clean
    clean = run_layers(items_with(base_f2[2], 'none'), golden_dir)
    print('変異なし:', 'OK（エラー0）' if not clean else f'エラーあり {dict(clean)}')
    all_ok = not clean
    print()
    for label, items in cases:
        errs = run_layers(items, golden_dir)
        caught = sorted(errs.keys())
        ok = bool(caught)
        all_ok &= ok
        print(f"{'OK ' if ok else 'NG '} {label:40s} 止めた層: {', '.join(caught) if caught else 'なし'}")
    print()
    print('結果:', '全変異を検出' if all_ok else '検出できない変異あり')
    return 0 if all_ok else 1


if __name__ == '__main__':
    sys.exit(main())
