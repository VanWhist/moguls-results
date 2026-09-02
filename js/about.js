// 「データについて」ページ＝注記の第3層。
// 各画面には要点1行だけを出し、詳しい話はここに集約する。

import * as data from './data.js';
import {
  el, clear, mountNav, errorBox, sampleNotice, seriesLabel, roundLabel, genderLabel, formatLabel,
  eventName, eventDates, verificationState, reportLink, LAYER_LABEL, knownGapsSummary, layerMark,
} from './ui.js';
import { REPORT_EMAIL, REPORT_ISSUES_URL } from './config.js';

function table(head, body, numericFrom = 1) {
  return el('div', { class: 'table-wrap' }, el('table', { class: 'mini' }, [
    el('thead', {}, el('tr', {}, head.map((h, i) =>
      el('th', { class: 'no-sort' + (i >= numericFrom ? ' num' : ''), text: h })))),
    el('tbody', {}, body.map((r) => el('tr', {}, r.map((c, i) =>
      el('td', { class: i >= numericFrom ? 'num' : '' }, c && c.nodeType ? c : String(c ?? '—')))))),
  ]));
}

function kv(pairs) {
  return el('div', { class: 'kv' }, pairs.map(([k, v]) => el('div', {}, [
    el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v === null || v === undefined ? '—' : v }),
  ])));
}

function layerStatus(v) {
  const m = layerMark(v);
  return el('span', { class: m.cls, text: m.mark + v });
}

function roundStateNode(v) {
  const st = verificationState(v);
  if (st === 'ok') return el('span', { class: 'verify-ok', text: '✓ 照合済み' });
  if (st === 'gap') return el('span', { class: 'verify-gap', text: '△ 一部未収録（FIS 未公開）' });
  return el('span', { class: 'verify-ng', text: '⚠ 未確認あり' });
}

async function main() {
  mountNav('about.html');
  try {
    const [m, events, rules] = await Promise.all([data.manifest(), data.events(), data.rules()]);
    const c = m.counts || {};

    const status = clear(document.getElementById('status'));
    const sn = sampleNotice(m);
    if (sn) status.append(sn);
    status.append(kv([
      ['データ版', m.dataVersion], ['大会', c.events], ['ラウンド', c.rounds],
      ['ラン', (c.runs ?? 0).toLocaleString('ja-JP')], ['選手', c.athletes],
    ]));

    // 出典：ラウンドごとの元 PDF
    const rows = [];
    for (const ev of events) {
      for (const r of ev.rounds || []) {
        const src = r.source || {};
        rows.push([
          r.date || '—', eventName(ev), genderLabel(r.gender) + ' ' + roundLabel(r.round),
          src.fis_url ? el('a', { href: src.fis_url, target: '_blank', rel: 'noopener', text: 'FIS の PDF' }) : el('span', { class: 'meta', text: src.pdf || '—' }),
          roundStateNode(r.verification),
        ]);
      }
    }
    rows.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
    clear(document.getElementById('sources')).append(el('details', {}, [
      el('summary', { text: 'ラウンドごとの元 PDF（' + rows.length + ' ラウンド）' }),
      table(['日付', '大会', 'ラウンド', '元 PDF', '検証'], rows, 99),
    ]));

    // 対象大会
    const evRows = [...events].sort((a, b) => (eventDates(a) < eventDates(b) ? 1 : -1)).map((ev) => [
      eventDates(ev), ev.season, seriesLabel(ev.series), ev.venue, formatLabel(ev.format),
      (ev.rounds || []).map((r) => genderLabel(r.gender) + roundLabel(r.round)).join('・'),
    ]);
    const bySeries = {};
    for (const ev of events) bySeries[ev.series] = (bySeries[ev.series] || 0) + 1;
    const evBox = clear(document.getElementById('events'));
    evBox.append(kv(Object.entries(bySeries).map(([s, n]) => [seriesLabel(s), n + ' 大会'])));
    evBox.append(el('details', {}, [
      el('summary', { text: '収録している大会の一覧（' + events.length + ' 大会）' }),
      table(['日付', 'シーズン', '種別', '会場', 'フォーマット', 'ラウンド'], evRows, 99),
    ]));
    // 既知の欠落（events[].known_gaps）。実施されたが FIS が審判別 PDF を出していない等、この DB に無いラウンド。
    const gapItems = [...events].sort((a, b) => (eventDates(a) < eventDates(b) ? 1 : -1))
      .flatMap((ev) => ((knownGapsSummary(ev) || {}).notes || []).map((n) => ({ ev, ...n })));
    evBox.append(el('h3', { text: '既知の欠落' }));
    evBox.append(gapItems.length
      ? el('ul', { class: 'meta' }, gapItems.map((x) => el('li', {}, [
        el('strong', { text: eventName(x.ev) + '　' + genderLabel(x.gender) + ' ' + roundLabel(x.round) }),
        '：' + x.note,
      ])))
      : el('p', { class: 'meta', text: 'なし（実施されたのに未収録のラウンドは登録されていません）。' }));

    // 検証の層。manifest.verification.layers は層の説明（文字列）なので、
    // 層ごとの結果は各ラウンドの verification を集計して出す。
    const v = m.verification || {};
    const layerNames = v.layers || {};
    const allRounds = events.flatMap((ev) => ev.rounds || []);
    const layerKeys = [...new Set([...Object.keys(LAYER_LABEL), ...Object.keys(layerNames),
      ...allRounds.flatMap((r) => Object.keys(r.verification || {}))])];
    const tally = (k) => {
      const c = {};
      for (const r of allRounds) {
        const s = (r.verification || {})[k] ?? '—';
        c[s] = (c[s] || 0) + 1;
      }
      return Object.entries(c).sort((a, b) => b[1] - a[1]);
    };
    clear(document.getElementById('layers')).append(
      table(['層', 'ラウンドごとの結果'], layerKeys.map((k) => [
        LAYER_LABEL[k] || (typeof layerNames[k] === 'string' ? layerNames[k] : k),
        el('span', {}, tally(k).flatMap(([s, n], i) => [i ? '　' : '', layerStatus(s), ' ' + n])),
      ]), 99),
      el('p', { class: 'meta', text: (v.allGreen ? '公開ゲート：全ラウンド緑。' : '公開ゲート：赤のラウンドがあります（該当大会は出力していません）。')
        + (v.warnings !== undefined ? '　警告 ' + v.warnings + ' 件（人が見て決めることの置き場。エラーではありません）' : '')
        + (v.goldenRuns !== undefined ? '　正解データ ' + v.goldenRuns + ' 本' : '')
        + (v.reportPath ? '　検証レポート：' + v.reportPath : '') }),
      el('p', { class: 'meta', text: 'このほか、正解データ（PDF を目視して作った golden/*.json）との回帰照合と、'
        + 'わざとデータを壊してどの層が止めるかを確かめる変異テストを ETL のたびに実行しています。' }),
    );
    // 実行件数（manifest.verification.counts）。無ければ出さない。
    const cnt = v.counts;
    if (cnt && typeof cnt === 'object') {
      const n = (x) => (x === null || x === undefined ? '—' : Number(x).toLocaleString('ja-JP'));
      const ratio = (a, b, unit) => n(a) + (b !== undefined ? ' / ' + n(b) : '') + ' ' + unit;
      document.getElementById('layers').append(
        el('h3', { text: '実行件数' }),
        table(['項目', '件数'], [
          ['PDF から読み取り', n(cnt.runs_parsed) + ' ラン'],
          ['2方式一致（第1層）', ratio(cnt.runs_ab_compared, cnt.runs_parsed, 'ラン')],
          ['再計算一致（第2層）', ratio(cnt.runs_recomputed, cnt.runs_parsed, 'ラン')],
          ['順位の再構成（第3層）', n(cnt.rounds_ranked) + ' ラウンド'],
          ['FIS Web 照合（第5層）', ratio(cnt.events_html_checked, cnt.events_html_expected, '大会')],
          ['正解データ回帰', n(cnt.golden_runs) + ' ラン'],
          ['変異テスト', n(cnt.mutations) + ' 種'],
        ], 1),
      );
    }

    // データ版
    clear(document.getElementById('version')).append(kv([
      ['データ版', m.dataVersion], ['生成日時', m.builtAt], ['パーサ版', m.parserVersion],
    ]), el('p', { class: 'meta', text: 'ファイル名は内容ハッシュ付きで、manifest.json が対応表です。ブラウザのキャッシュはデータ版で切り替わります。' }));

    // 規則版。ETL の rules は { versions: { "2024-25": {...} }, formats: {...} }。
    // 配列（[{version, ...}]）でも読めるようにしておく。
    const versions = Array.isArray(rules)
      ? rules.map((r) => [r.version || '—', r])
      : Object.entries((rules && rules.versions) || rules || {});
    const rBox = clear(document.getElementById('rules'));
    const judges = (r) => r.judges ? r.judges.turns + ' / ' + r.judges.air : [r.turn_judges, r.air_judges].filter((x) => x !== undefined).join(' / ') || '—';
    const discard = (r) => r.discard_high_low ? '最高・最低' : r.discard ? '最高' + r.discard.high + '・最低' + r.discard.low : '—';
    rBox.append(table(
      ['版', 'ターン / エア判定', '除外', '切り捨て', '1ジャンプ上限', 'ターン下限', 'ペース速度 M / W', 'DD 表', '出典'],
      versions.map(([ver, r]) => [
        ver, judges(r), discard(r),
        r.truncate_decimals !== undefined ? '小数第' + r.truncate_decimals + '位' : '—',
        r.air_cap_per_judge ?? r.jump_max ?? '—',
        r.turns_floor ?? r.turns_min ?? '—',
        r.pace_speed_mps ? r.pace_speed_mps.M + ' / ' + r.pace_speed_mps.W + ' m/s' : '—',
        r.dd_table || r.dd_table_version || '（PDF の印字値）',
        r.source || (r.sources || []).join('、') || '—',
      ]), 99));
    const formats = (rules && rules.formats) || {};
    if (Object.keys(formats).length) {
      rBox.append(el('h3', { text: '大会フォーマットと通過人数' }));
      rBox.append(table(['フォーマット', 'ラウンド', '通過'], Object.entries(formats).map(([k, f]) => [
        (f.label || k) + '（' + k + '）',
        (f.rounds || []).join(' → '),
        Object.entries(f.advance || {}).map(([from, a]) => from + '→' + a.to + ' ' + a.n + '名'
          + (a.direct ? '（直接）' : '') + (a.best_of ? '（' + a.best_of.join('/') + ' の高い方）' : '')).join('　'),
      ]), 99));
    }
    rBox.append(el('details', {}, [
      el('summary', { text: '規則版の全項目（JSON）' }),
      el('pre', { class: 'code', text: JSON.stringify(rules, null, 1) }),
    ]));

    // 報告先
    clear(document.getElementById('report')).append(el('p', {}, [
      reportLink({ dataVersion: m.dataVersion }),
      el('span', { class: 'meta', text: REPORT_EMAIL ? '　（メール：' + REPORT_EMAIL + '）' : '　（GitHub の Issue：' + REPORT_ISSUES_URL + '）' }),
    ]));
  } catch (err) {
    document.getElementById('app').prepend(errorBox(err.message));
    console.error(err);
  }
}

main();
