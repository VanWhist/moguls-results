// ページ① リザルト。事実データを見る場所で、分析はしない。
//
// 入口の考え方：一覧を見せてから探させるのではなく、知りたい選手・大会へ最短で到達させ、
// 必要なときだけ結果表を開く。初期表示は「最近の大会」で、いきなり全ランの表は出さない。
//
// URL は index.html?event=<event_id>&round=<round_id> で特定のラウンドを開ける
// （選手ページの履歴から飛んでくる）。

import * as data from './data.js';
import { RESULTS_PER_PAGE } from './config.js';
import {
  el, clear, cell, num, mountNav, errorBox, paginate, renderPager, isNarrow, onWidthChange,
  noteLayers, sampleNotice, seriesLabel, roundLabel, genderLabel, formatLabel, eventName, eventDates,
  verificationBadge, layerMark, statusBadge, reportLink, athleteMatches, athleteHref, LAYER_LABEL, isQ1Block,
  layerStatusLabel, knownGapsSummary,
} from './ui.js';

const state = { q: '', season: '', series: '', gender: '', eventId: '', roundId: '', page: 1, view: 'fis' };

// 結果表の見た目。'fis' = FIS 公式 PDF と同じ3行ブロック（既定）、'table' = 1ラン1行の表。
// localStorage が使えない環境（プライベートモード等）でも既定で表示できるように try/catch で包む。
const VIEW_KEY = 'moguls-results.view';
function loadView() {
  try { return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'fis'; } catch (e) { return 'fis'; }
}
function saveView(v) {
  try { localStorage.setItem(VIEW_KEY, v); } catch (e) { /* 覚えられなくても表示は切り替える */ }
}

let events = [];
let runs = [];
let athletes = [];
let manifest = null;
const eventById = new Map();
const roundById = new Map();     // round_id → { event, round }

// ---- 絞り込み ---------------------------------------------------------------

function eventMatches(ev) {
  if (state.season && ev.season !== state.season) return false;
  if (state.series && ev.series !== state.series) return false;
  if (state.gender && !(ev.rounds || []).some((r) => r.gender === state.gender)) return false;
  if (state.q) {
    const q = state.q.toLowerCase();
    const hay = [eventName(ev), ev.event_id, ev.nation].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function hasCondition() {
  return !!(state.q || state.season || state.series || state.gender);
}

function latestDate(ev) {
  return (ev.rounds || []).map((r) => r.date || '').sort().pop() || '';
}

// ---- 大会カード -------------------------------------------------------------

function renderRecent() {
  const box = clear(document.getElementById('recent'));
  const list = events.filter(eventMatches).sort((a, b) => (latestDate(a) < latestDate(b) ? 1 : -1));
  const shown = hasCondition() ? list : list.slice(0, 12);
  document.getElementById('recent-title').textContent = hasCondition()
    ? '該当する大会（' + list.length + '）' : '最近の大会';
  if (!shown.length) {
    box.append(el('p', { class: 'meta', text: '該当する大会がありません。' }));
    return;
  }
  for (const ev of shown) {
    const genders = [...new Set((ev.rounds || []).map((r) => r.gender))];
    box.append(el('div', { class: 'meet-card' }, [
      el('div', { class: 'meet-date', text: eventDates(ev) + '　' + ev.season }),
      el('div', { class: 'meet-name', text: seriesLabel(ev.series) + '　' + ev.venue }),
      el('div', { class: 'meet-sub' }, genders.map((g) => el('span', { class: 'badge gender', text: genderLabel(g) + ' ' }))),
      el('div', { class: 'round-chips' }, sortedRounds(ev).map((r) => el('button', {
        class: 'chip', text: genderLabel(r.gender) + ' ' + roundLabel(r.round),
        onclick: () => openRound(ev.event_id, r.round_id),
      }))),
      gapLine(ev),
    ]));
  }
}

// ラウンドの並びは ETL の順（男子 Q→F1→F2、次に女子）をそのまま使う。日付で並べ替えない。
function sortedRounds(ev) {
  return [...(ev.rounds || [])];
}

// 既知の欠落（known_gaps）。一行だけ出し、押すと注記の全文。
function gapLine(ev) {
  const g = knownGapsSummary(ev);
  if (!g) return null;
  return el('details', { class: 'gap-line', title: g.notes.map((n) => n.text).join('\n') }, [
    el('summary', { text: 'ⓘ ' + g.line }),
    el('ul', { class: 'meta' }, g.notes.map((n) => el('li', { text: n.text }))),
  ]);
}

// ---- ラウンドの結果表 ------------------------------------------------------

function openRound(eventId, roundId, push = true) {
  const ev = eventById.get(eventId);
  if (!ev) return;
  const rounds = sortedRounds(ev);
  const round = rounds.find((r) => r.round_id === roundId) || rounds[0];
  state.eventId = eventId;
  state.roundId = round ? round.round_id : '';
  state.page = 1;
  if (push) {
    const u = new URL(location.href);
    u.searchParams.set('event', eventId);
    if (state.roundId) u.searchParams.set('round', state.roundId);
    history.pushState(null, '', u);
  }
  document.getElementById('recent-card').hidden = true;
  document.getElementById('results-card').hidden = false;

  const head = clear(document.getElementById('event-head'));
  head.append(el('h2', { text: eventName(ev) }));
  head.append(el('p', { class: 'meta', text: 'フォーマット：' + formatLabel(ev.format, ev) + '　開催国：' + (ev.nation || '—') }));

  const chips = clear(document.getElementById('round-chips'));
  for (const r of rounds) {
    chips.append(el('button', {
      class: 'chip' + (r.round_id === state.roundId ? ' active' : ''),
      'aria-pressed': r.round_id === state.roundId ? 'true' : 'false',
      onclick: () => openRound(eventId, r.round_id),
    }, [
      el('span', { text: genderLabel(r.gender) + ' ' + roundLabel(r.round) }),
      el('span', { class: 'chip-sub', text: r.date || '—' }),
    ]));
  }
  renderRound();
  window.scrollTo({ top: 0 });
}

function closeRound() {
  state.eventId = '';
  state.roundId = '';
  const u = new URL(location.href);
  u.searchParams.delete('event');
  u.searchParams.delete('round');
  history.pushState(null, '', u);
  document.getElementById('results-card').hidden = true;
  document.getElementById('recent-card').hidden = false;
}

function renderRoundHead(ev, round) {
  const box = clear(document.getElementById('round-head'));
  const course = round.course || {};
  box.append(el('div', { class: 'round-head' }, [
    el('h3', { class: 'round-title', text: genderLabel(round.gender) + ' ' + roundLabel(round.round) }),
    el('span', { class: 'meta', text: (round.date || '—') + (round.start_time ? ' ' + round.start_time : '')
      + '　codex ' + (round.codex || '—') + '　出走 ' + (round.n_competitors ?? '—') + ' 名'
      + '　ペースタイム ' + (num(round.pace_time, 2) ?? '—') + ' 秒'
      + (course.name ? '　コース ' + course.name + (course.length_m ? ' ' + course.length_m + ' m' : '') : '') }),
  ]));

  // 「✓ FIS公式結果と照合済み」→ 押すと検証項目一覧・元PDF・誤り報告
  const badge = verificationBadge(round.verification);
  const body = el('div', { class: 'verify-body', hidden: true });
  const layers = Object.entries(round.verification || {});
  body.append(el('ul', { class: 'meta' }, layers.map(([k, v]) => el('li', {}, [
    el('span', { class: layerMark(v).cls, text: layerMark(v).mark }),
    (LAYER_LABEL[k] || k) + '：' + layerStatusLabel(v),
  ]))));
  const gaps = knownGapsSummary(ev);
  if (gaps) body.append(el('p', { class: 'meta', text: 'この大会の既知の欠落：' + gaps.notes.map((n) => n.text).join('　') }));
  const judges = round.judges || [];
  if (judges.length) {
    body.append(el('p', { class: 'meta', text: '審判：' + judges.map((j) => 'J' + j.no + ' ' + j.name + ' (' + j.noc + ')').join('、') }));
  }
  const src = round.source || {};
  const pdfNode = src.fis_url
    ? el('a', { href: src.fis_url, target: '_blank', rel: 'noopener', text: '元PDFを見る（FIS）' })
    : el('span', { class: 'meta', text: '元PDF：' + (src.pdf || '—') + '（FIS 上の URL は未登録）' });
  body.append(el('div', { class: 'tag-row' }, [
    pdfNode,
    reportLink({ round_id: round.round_id, dataVersion: manifest.dataVersion, pdf: src.pdf }),
    src.report_created ? el('span', { class: 'meta', text: 'PDF 作成 ' + src.report_created }) : null,
    src.rules_version ? el('span', { class: 'meta', text: '規則版 ' + src.rules_version }) : null,
  ]));
  const toggle = el('button', {
    class: 'link-button verify-line ' + badge.cls,
    text: badge.text,
    'aria-expanded': 'false',
    onclick: () => { body.hidden = !body.hidden; toggle.setAttribute('aria-expanded', String(!body.hidden)); },
  });
  box.append(toggle, body);
}

// ラウンド内のランを表示順に並べる。Q2 ファイルは選手ごとに Q2 → Q1参考 の2行。
function orderedRuns(round) {
  const mine = runs.filter((r) => r.round_id === round.round_id);
  const byRank = (a, b) => {
    const an = a.rank === null || a.rank === undefined, bn = b.rank === null || b.rank === undefined;
    if (an && bn) return (a.bib || 0) - (b.bib || 0);
    if (an) return 1;
    if (bn) return -1;
    return a.rank - b.rank;
  };
  const isQ = mine.some((r) => r.q_block);
  if (!isQ) return mine.sort(byRank).map((r) => ({ run: r, role: null, pairTop: false }));
  // 二段レイアウト。選手ごとに Q2 の走り → Q1 の走り（参考）。Q1 の直接通過者は Q1 の1行だけ。
  const groups = new Map();
  for (const r of mine) {
    if (!groups.has(r.fis_code)) groups.set(r.fis_code, []);
    groups.get(r.fis_code).push(r);
  }
  const heads = [...groups.values()].map((g) => g.find((r) => r.q_block === 'Q2') || g[0]).sort(byRank);
  const out = [];
  for (const h of heads) {
    const g = groups.get(h.fis_code);
    const q2 = g.find((r) => r.q_block === 'Q2');
    const q1 = g.find((r) => isQ1Block(r));
    if (q2) out.push({ run: q2, role: 'Q2', pairTop: !!q1 });
    if (q1) out.push({ run: q1, role: q2 ? 'Q1ref' : 'Q1', pairTop: false });
  }
  return out;
}

function roleBadge(item) {
  if (!item.role) return [];
  const label = item.role === 'Q1ref' ? 'Q1参考' : item.role;
  return [
    el('span', { class: 'badge plain', text: ' ' + label }),
    item.run.counting ? el('span', { class: 'badge official', text: ' 採用' }) : null,
  ];
}

function judgeCells(values, discard, digits, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const v = values && values[i];
    const dropped = (discard || []).includes(i);
    const text = num(v, digits);
    out.push(el('td', {
      class: 'num' + (text === null ? ' blank' : '') + (dropped ? ' discard' : '') + (i === 0 ? ' sep' : ''),
      title: dropped ? '最高・最低のため除外' : null,
      text: text === null ? '—' : text,
    }));
  }
  return out;
}

function airCells(air, idx) {
  const a = (air || [])[idx] || {};
  return [
    cell(a.J6, 1, idx === 0 ? 'sep' : ''),
    cell(a.J7, 1),
    el('td', { class: a.jump ? '' : 'blank', text: a.jump || '—' }),
    cell(a.dd, 2),
  ];
}

function nameCell(item) {
  const run = item.run;
  if (item.role === 'Q1ref') return el('td', {}, roleBadge(item));
  return el('td', {}, [
    el('a', { href: athleteHref(run.athlete_id || run.fis_code), text: run.name }),
    ...roleBadge(item),
    ...statusBadge(run),
  ]);
}

function rowClass(item) {
  const r = item.run;
  const cls = [];
  if (item.role === 'Q1ref') cls.push('qref');
  if (item.role && r.counting) cls.push('counting');
  if (item.pairTop) cls.push('pair-top');
  return cls.join(' ');
}

function renderTable(items) {
  const g = (text, span, cls = '') => el('th', { class: 'grp no-sort ' + cls, colspan: span, text });
  const h = (text, cls = '') => el('th', { class: 'no-sort ' + cls, text });
  const head1 = el('tr', {}, [
    g('', 6), g('Air 1', 4, 'sep'), g('Air 2', 4, 'sep'), g('', 1), g('Base (Turns)', 5, 'sep'), g('', 1),
    g('Ded (Turns)', 5, 'sep'), g('', 1), g('', 4),
  ]);
  const head2 = el('tr', {}, [
    h('Rank', 'num'), h('Bib', 'num'), h('Name'), h('NOC'), h('Time(s)', 'num'), h('Time Pts', 'num'),
    h('J6', 'num sep'), h('J7', 'num'), h('Jump'), h('DD', 'num'),
    h('J6', 'num sep'), h('J7', 'num'), h('Jump'), h('DD', 'num'),
    h('Air Total', 'num'),
    h('J1', 'num sep'), h('J2', 'num'), h('J3', 'num'), h('J4', 'num'), h('J5', 'num'), h('Base Total', 'num'),
    h('J1', 'num sep'), h('J2', 'num'), h('J3', 'num'), h('J4', 'num'), h('J5', 'num'), h('Ded Total', 'num'),
    h('Turns', 'num'), h('Score', 'num'), h('Tie'), h('Status'),
  ]);
  const body = el('tbody', {}, items.map((item) => {
    const r = item.run;
    const ref = item.role === 'Q1ref';
    return el('tr', { class: rowClass(item) }, [
      el('td', { class: r.rank ? 'num' : 'num blank', text: ref ? '' : (r.rank ?? '—') }),
      el('td', { class: 'num', text: ref ? '' : (r.bib ?? '—') }),
      nameCell(item),
      el('td', { text: ref ? '' : (r.noc || '—') }),
      cell(r.seconds, 2), cell(r.time_points, 2),
      ...airCells(r.air, 0), ...airCells(r.air, 1),
      cell(r.air_total, 2),
      ...judgeCells(r.base, r.base_discard, 1, 5), cell(r.base_total, 1),
      ...judgeCells(r.ded, r.ded_discard, 1, 5), cell(r.ded_total, 1),
      el('td', { class: 'num', title: r.turns_floor_applied ? 'ターン下限 0.3 を適用' : null,
        text: (num(r.turns_total, 1) ?? '—') + (r.turns_floor_applied ? '*' : '') }),
      cell(r.run_score, 2),
      el('td', { class: r.tie ? '' : 'blank', text: r.tie || '—' }),
      el('td', { text: r.status || '—' }),
    ]);
  }));
  return el('div', { class: 'table-wrap' }, el('table', {}, [el('thead', {}, [head1, head2]), body]));
}

// ---- FIS 公式リザルト PDF と同じ並びの表 ----------------------------------------
// 選手・コーチが見慣れているのは FIS の PDF なので、既定はその形にする。
// 1選手 = 3行。1行目: 順位〜YB・タイム・エア1・B: ベース点・Run Score、
// 2行目: エア2・D: 減点、3行目: タイム点・エア合計・ターン合計（罫線の下に太字）。
// Q2 の PDF（q_layout）は YB の後に Q1/Q2 のラベル列、Run Score の後に Best Score 列があり、
// Q2 の走りの下に Q1 の走りを同じ3行で積む。DNF/DNS/DSQ は識別列と状態のみの1行。

// orderedRuns の並び（Q2 → Q1参考）を選手単位にまとめる
function fisBlocks(items) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const next = items[i + 1];
    if (it.pairTop && next && next.role === 'Q1ref') {
      out.push([it, next]);
      i++;
    } else {
      out.push([it]);
    }
  }
  return out;
}

const fisBlanks = (n) => Array.from({ length: n }, () => el('td'));

function fisNum(v, digits, cls = '') {
  const text = num(v, digits);
  return el('td', { class: ('num ' + cls).trim(), text: text === null ? '' : text });
}

function fisJudgeCells(values, discard) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const dropped = (discard || []).includes(i);
    out.push(el('td', {
      class: 'num' + (dropped ? ' discard' : ''),
      title: dropped ? '最高・最低のため除外' : null,
      text: num(values && values[i], 1) ?? '',
    }));
  }
  return out;
}

function fisAirCells(air, idx) {
  const a = (air || [])[idx] || {};
  return [fisNum(a.J6, 1), fisNum(a.J7, 1), el('td', { class: 'jump', text: a.jump || '' }), fisNum(a.dd, 2)];
}

// 識別列（Rank〜YB、Q レイアウトなら Q1/Q2 ラベルも）。Q1 参考ブロックはラベルだけ出す
function fisIdentityCells(item, qLayout) {
  const r = item.run;
  const head = item.role !== 'Q1ref';
  const cells = [
    el('td', { class: 'num bold', text: head ? (r.rank ?? '') : '' }),
    el('td', { class: 'num', text: head ? (r.bib ?? '') : '' }),
    el('td', { class: 'num', text: head ? (r.fis_code || '') : '' }),
    el('td', { class: 'name' }, head ? [el('a', { href: athleteHref(r.athlete_id || r.fis_code), text: r.name })] : []),
    el('td', { text: head ? (r.noc || '') : '' }),
    el('td', { class: 'num', text: head ? (r.yb ?? '') : '' }),
  ];
  if (qLayout) cells.push(el('td', { class: 'qlab', text: item.role === 'Q1ref' ? 'Q1' : (item.role || '') }));
  return cells;
}

// Run Score・Best Score・Tie（1行目のみ）。PDF は RES を Run Score の後（Tie の位置）に印字する
function fisScoreCells(item, qLayout) {
  const r = item.run;
  const dnf = r.status && r.status !== 'OK';
  const score = el('td', { class: 'num bold score', text: dnf ? r.status : (num(r.run_score, 2) ?? '') });
  const best = qLayout ? [fisNum(item.role === 'Q1ref' ? null : r.best_score, 2, 'bold')] : [];
  const tie = el('td', { class: 'num tie' }, [
    num(r.tie, 1) ?? '',
    r.reserve_judge ? el('span', { class: 'fis-res', text: 'RES',
      title: 'リザーブジャッジが採点したラン（PDF の RES 印）' }) : null,
  ]);
  return [score, ...best, tie];
}

function fisRows(item, qLayout) {
  const r = item.run;
  const idCount = 6 + (qLayout ? 1 : 0);
  const scoreCount = 2 + (qLayout ? 1 : 0);
  const sub = item.role === 'Q1ref' ? ' fis-sub' : '';
  if (r.status && r.status !== 'OK') {
    // DNF/DNS/DSQ：識別列と状態だけ。PDF も他の欄は空
    return [el('tr', { class: 'fis-l1 fis-status' + sub }, [
      ...fisIdentityCells(item, qLayout), ...fisBlanks(14), ...fisScoreCells(item, qLayout),
    ])];
  }
  const line1 = el('tr', { class: 'fis-l1' + sub }, [
    ...fisIdentityCells(item, qLayout),
    fisNum(r.seconds, 2), fisNum(r.time_points, 2),
    ...fisAirCells(r.air, 0), el('td'),
    el('td', { class: 'bd', text: 'B:' }), ...fisJudgeCells(r.base, r.base_discard), fisNum(r.base_total, 1),
    ...fisScoreCells(item, qLayout),
  ]);
  const line2 = el('tr', { class: 'fis-l2' }, [
    ...fisBlanks(idCount + 2),
    ...fisAirCells(r.air, 1), el('td'),
    el('td', { class: 'bd', text: 'D:' }), ...fisJudgeCells(r.ded, r.ded_discard), fisNum(r.ded_total, 1),
    ...fisBlanks(scoreCount),
  ]);
  const line3 = el('tr', { class: 'fis-l3' }, [
    ...fisBlanks(idCount + 1),
    fisNum(r.time_points, 2, 'bold rule'),
    ...fisBlanks(4), fisNum(r.air_total, 2, 'bold rule'),
    ...fisBlanks(6),
    el('td', { class: 'num bold rule', title: r.turns_floor_applied ? 'ターン下限 0.3 を適用' : null,
      text: (num(r.turns_total, 1) ?? '') + (r.turns_floor_applied ? '*' : '') }),
    ...fisBlanks(scoreCount),
  ]);
  return [line1, line2, line3];
}

function renderFis(items) {
  const qLayout = items.some((it) => !!it.role);
  const th = (text, attrs = {}) => el('th', { class: 'no-sort ' + (attrs.class || ''), rowspan: attrs.rowspan, colspan: attrs.colspan, text });
  const head1 = el('tr', {}, [
    th('Rank', { rowspan: 2 }), th('Bib', { rowspan: 2 }), th('FIS Code', { rowspan: 2 }), th('Name', { rowspan: 2, class: 'name' }),
    th('NSA Code', { rowspan: 2 }), th('YB', { rowspan: 2 }),
    qLayout ? th('', { rowspan: 2 }) : null,
    th('Time', { colspan: 2, class: 'grp' }), th('Air', { colspan: 5, class: 'grp' }), th('Turns', { colspan: 7, class: 'grp' }),
    th('Run Score', { rowspan: 2 }), qLayout ? th('Best Score', { rowspan: 2 }) : null, th('Tie', { rowspan: 2 }),
  ]);
  const head2 = el('tr', {}, [
    th('Seconds', { class: 'gl' }), th('Time Points', { class: 'gr' }),
    th('J6', { class: 'gl' }), th('J7'), th('Jump'), th('DD'), th('Total', { class: 'gr' }),
    th('B D', { class: 'gl' }), th('J1'), th('J2'), th('J3'), th('J4'), th('J5'), th('Total', { class: 'gr' }),
  ]);
  const bodies = fisBlocks(items).map((block) => el('tbody', { class: 'fis-block' },
    block.flatMap((item) => fisRows(item, qLayout))));
  return el('div', { class: 'table-wrap' }, el('table', { class: 'fis' }, [el('thead', {}, [head1, head2]), ...bodies]));
}

// ---- 狭い画面（スマホ）：1選手＝1カード ------------------------------------------
// 見出し行（順位・名前・NOC・Run Score）の下に、FIS の PDF と同じ並びの3行ブロックを
// 識別列抜きで置く。1行目: 秒・タイム点｜J6 J7 Jump DD｜B: J1〜J5 計、2行目: エア2｜D: 減点、
// 3行目: タイム点・エア計・ターン計（太字）。ブロックだけ横スクロールし、ページは横に動かさない。
// Q2 の PDF は同じカードに Q2 → Q1 の順で積み、見出しには Best Score を出す。

const isDnf = (r) => !!(r.status && r.status !== 'OK');

function resMark(r) {
  return r.reserve_judge ? el('span', { class: 'fis-res', text: 'RES',
    title: 'リザーブジャッジが採点したラン（PDF の RES 印）' }) : null;
}

// 得点の表示。状態（DNF/DNS/DSQ）のランは得点の代わりに状態を出す
function scoreNode(r, value, cls) {
  if (value === null || value === undefined) {
    return isDnf(r) ? el('span', { class: cls + ' fis-status', text: r.status }) : el('span', { class: cls, text: '—' });
  }
  return el('span', { class: cls }, [num(value, 2), resMark(r)]);
}

// 横スクロールさせず 360px に収める2段構成。
// 上段：秒・タイム点（太字）｜エア2本を縦に（J6 J7 ジャンプ DD）｜エア計（太字）
// 下段：B: J1〜J5 計 ／ D: J1〜J5 計 ／ ターン計（太字・右寄せ）
function miniBlock(r) {
  const jumpRow = (idx) => {
    const a = (r.air || [])[idx] || {};
    return el('tr', {}, [fisNum(a.J6, 1), fisNum(a.J7, 1), el('td', { class: 'jump', text: a.jump || '' }), fisNum(a.dd, 2)]);
  };
  const sec = num(r.seconds, 2);
  const timeAir = el('div', { class: 'fm-sec fm-timeair' }, [
    el('div', { class: 'fm-time' }, [
      el('span', { class: 'fm-sec-val', text: sec === null ? '' : sec + ' s' }),
      el('b', { text: num(r.time_points, 2) ?? '' }),
    ]),
    el('table', { class: 'fis fis-mini fm-air' }, el('tbody', {}, [jumpRow(0), jumpRow(1)])),
    el('div', { class: 'fm-total' }, [
      el('span', { class: 'fm-lbl', text: 'エア' }),
      el('b', { text: num(r.air_total, 2) ?? '' }),
    ]),
  ]);
  const turns = el('table', { class: 'fis fis-mini fm-turns' }, el('tbody', {}, [
    el('tr', {}, [el('td', { class: 'bd', text: 'B:' }), ...fisJudgeCells(r.base, r.base_discard), fisNum(r.base_total, 1, 'tot')]),
    el('tr', {}, [el('td', { class: 'bd', text: 'D:' }), ...fisJudgeCells(r.ded, r.ded_discard), fisNum(r.ded_total, 1, 'tot')]),
    el('tr', { class: 'fis-l3' }, [
      el('td', { class: 'bd lbl rule', text: 'ターン' }),
      el('td', { class: 'num bold rule', colspan: 6, title: r.turns_floor_applied ? 'ターン下限 0.3 を適用' : null,
        text: (num(r.turns_total, 1) ?? '') + (r.turns_floor_applied ? '*' : '') }),
    ]),
  ]));
  return el('div', { class: 'fis-mini-block' }, [timeAir, turns]);
}

// 状態のランでも、印字された部分点があればブロックを出す（PDF と同じ）
function hasMarks(r) {
  return [r.seconds, r.time_points, r.air_total, r.base_total, r.ded_total, r.turns_total]
    .some((v) => v !== null && v !== undefined) || (r.air || []).length > 0;
}

function renderCards(items) {
  const qLayout = items.some((it) => !!it.role);
  const cards = fisBlocks(items).map((block) => {
    const head = block[0].run;
    const headScore = qLayout ? (head.best_score ?? head.run_score) : head.run_score;
    const parts = [
      el('div', { class: 'fis-card-head' }, [
        el('span', { class: 'fis-rank', text: head.rank ?? '' }),
        el('span', { class: 'fis-name' }, el('a', { href: athleteHref(head.athlete_id || head.fis_code), text: head.name })),
        el('span', { class: 'fis-noc', text: head.noc || '' }),
        scoreNode(head, headScore, 'fis-score'),
      ]),
    ];
    for (const item of block) {
      const r = item.run;
      if (qLayout) {
        parts.push(el('div', { class: 'fis-sub-head' + (r.counting ? ' counting' : '') }, [
          el('span', { text: item.role === 'Q1ref' ? 'Q1' : (item.role || '') }),
          r.counting ? el('span', { class: 'badge official', text: '採用' }) : null,
          scoreNode(r, r.run_score, 'fis-sub-score'),
        ]));
      }
      if (!isDnf(r) || hasMarks(r)) parts.push(miniBlock(r));
    }
    return el('article', { class: 'rec fis-card' }, parts);
  });
  return el('div', {}, [
    el('p', { class: 'meta small fis-legend', text: '上段：秒・タイム点（太字）｜エア2本の J6 J7 ジャンプ DD｜エア計。'
      + '下段：B: ベース点 J1〜J5 計 ／ D: 減点 J1〜J5 計 ／ ターン計。取り消し線は最高・最低で除外された点。' }),
    el('div', { class: 'card-list' }, cards),
  ]);
}

function renderRound() {
  const info = roundById.get(state.roundId);
  const box = clear(document.getElementById('results'));
  if (!info) {
    box.append(el('p', { class: 'meta', text: 'ラウンドがありません。' }));
    return;
  }
  renderRoundHead(info.event, info.round);
  const items = orderedRuns(info.round);
  const view = paginate(items, state.page, RESULTS_PER_PAGE);
  state.page = view.page;
  box.append(isNarrow() ? renderCards(view.items)
    : state.view === 'table' ? renderTable(view.items) : renderFis(view.items));
  for (const id of ['pager-top', 'pager-bottom']) {
    renderPager(document.getElementById(id), view, (p) => {
      state.page = p;
      renderRound();
      document.getElementById('results-card').scrollIntoView({ block: 'start' });
    });
  }
}

// ---- 検索候補 ---------------------------------------------------------------
// 入力に応じて選手候補を出し、押したらそのまま選手ページへ送る。大会候補は結果表へ。

function renderSuggest() {
  const box = document.getElementById('suggest');
  const q = state.q.trim();
  clear(box);
  if (q.length < 1) { box.hidden = true; return; }

  const hits = athletes.filter((a) => athleteMatches(a, q)).slice(0, 6);
  const evHits = events.filter((ev) => eventName(ev).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (latestDate(a) < latestDate(b) ? 1 : -1)).slice(0, 3);
  if (!hits.length && !evHits.length) { box.hidden = true; return; }

  for (const a of hits) {
    box.append(el('button', { class: 'suggest-item',
      onclick: () => { location.href = athleteHref(a.athlete_id); } }, [
      el('span', { class: 'sug-name', text: a.name }),
      el('span', { class: 'sug-meta', text: (a.noc || '') + '　' + (a.aliases || []).join('・')
        + (a.n_runs ? '　' + a.n_runs + 'ラン' : '') }),
      el('span', { class: 'sug-go', text: '選手ページを見る →' }),
    ]));
  }
  for (const ev of evHits) {
    box.append(el('button', { class: 'suggest-item',
      onclick: () => {
        document.getElementById('q').value = '';
        state.q = '';
        renderSuggest();
        renderRecent();
        openRound(ev.event_id);
      } }, [
      el('span', { class: 'sug-name', text: eventName(ev) }),
      el('span', { class: 'sug-meta', text: eventDates(ev) + '　' + (ev.rounds || []).length + 'ラウンド' }),
      el('span', { class: 'sug-go', text: 'この大会を見る →' }),
    ]));
  }
  box.hidden = false;
}

// ---- 起動 -------------------------------------------------------------------

function fillSelect(id, values, label) {
  const sel = clear(document.getElementById(id));
  sel.append(el('option', { value: '', text: label }));
  for (const v of values) sel.append(el('option', { value: v.value, text: v.text }));
}

function buildNote() {
  const slot = clear(document.getElementById('note-slot'));
  const sn = sampleNotice(manifest);
  if (sn) slot.append(sn);
  slot.append(noteLayers(
    '取り消し線の薄い数字は最高・最低のため除外された審判点です（合計には入っていません）',
    [
      el('p', { class: 'meta', text: 'ターンは J1〜J5 のベース点・減点それぞれで最高と最低を除き、残り3名の合計を使います。'
        + '除外された点は消さずに薄く表示しています。' }),
      el('p', { class: 'meta', text: 'エアはジャッジごとに 点 × DD を小数第2位で切り捨て（上限 10.0）、J6・J7 を平均し、2本を足して切り捨てます。'
        + 'タイム点は 48 − 32 × タイム ÷ ペースタイム（0〜20）。ターンの下限は 0.3（* 印）。' }),
      el('p', { class: 'meta', text: '「リザーブジャッジ採点」は PDF の Tie 欄に RES と印字されたラン。状態（DNF/DNS/DSQ）のランは得点を空欄にしています。' }),
      el('p', { class: 'meta', text: 'Q2 の PDF は Q2 の走りと Q1 の走り（参考）を1選手2段で載せています。採用された方（高い方）を太字にしています。' }),
    ]));
}

function readUrl() {
  const u = new URL(location.href);
  const ev = u.searchParams.get('event');
  const rd = u.searchParams.get('round');
  if (rd && roundById.has(rd)) openRound(roundById.get(rd).event.event_id, rd, false);
  else if (ev && eventById.has(ev)) openRound(ev, '', false);
  else {
    state.eventId = '';
    state.roundId = '';
    document.getElementById('results-card').hidden = true;
    document.getElementById('recent-card').hidden = false;
  }
}

async function main() {
  mountNav('index.html');
  try {
    const [evs, rs, mf, as] = await Promise.all([
      data.events(), data.allRuns(), data.manifest(), data.athletes(),
    ]);
    events = evs;
    runs = rs;
    manifest = mf;
    athletes = as;
    for (const ev of events) {
      eventById.set(ev.event_id, ev);
      for (const r of ev.rounds || []) roundById.set(r.round_id, { event: ev, round: r });
    }

    buildNote();
    renderRecent();

    fillSelect('f-season', [...new Set(events.map((e) => e.season))].sort().reverse()
      .map((v) => ({ value: v, text: v })), 'シーズン（すべて）');
    fillSelect('f-series', [...new Set(events.map((e) => e.series))]
      .map((v) => ({ value: v, text: seriesLabel(v) })), '大会種別（すべて）');
    fillSelect('f-gender', [...new Set(events.flatMap((e) => (e.rounds || []).map((r) => r.gender)))].sort()
      .map((v) => ({ value: v, text: genderLabel(v) })), '男女（すべて）');

    const q = document.getElementById('q');
    q.addEventListener('input', () => {
      state.q = q.value;
      renderSuggest();
      renderRecent();
      document.getElementById('reset').hidden = !hasCondition();
    });
    q.addEventListener('blur', () => setTimeout(() => {
      document.getElementById('suggest').hidden = true;
    }, 180));

    for (const [id, key] of [['f-season', 'season'], ['f-series', 'series'], ['f-gender', 'gender']]) {
      const node = document.getElementById(id);
      node.addEventListener('change', () => {
        state[key] = node.value;
        renderRecent();
        document.getElementById('reset').hidden = !hasCondition();
        if (state.eventId) closeRound();
      });
    }

    const toggle = document.getElementById('toggle-filters');
    toggle.addEventListener('click', () => {
      const box = document.getElementById('filters');
      box.hidden = !box.hidden;
      toggle.setAttribute('aria-expanded', String(!box.hidden));
      toggle.textContent = box.hidden ? '詳しく絞り込む ▼' : '絞り込みを閉じる ▲';
    });

    document.getElementById('reset').addEventListener('click', () => {
      Object.assign(state, { q: '', season: '', series: '', gender: '' });
      for (const id of ['q', 'f-season', 'f-series', 'f-gender']) document.getElementById(id).value = '';
      document.getElementById('suggest').hidden = true;
      document.getElementById('reset').hidden = true;
      renderRecent();
      if (state.eventId) closeRound();
    });

    // 表示形式（FIS形式／表形式）
    state.view = loadView();
    const viewButtons = [...document.querySelectorAll('#view-toggle button[data-view]')];
    const syncView = () => {
      for (const b of viewButtons) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
    };
    for (const b of viewButtons) {
      b.addEventListener('click', () => {
        if (state.view === b.dataset.view) return;
        state.view = b.dataset.view;
        saveView(state.view);
        syncView();
        if (state.roundId) renderRound();
      });
    }
    syncView();

    document.getElementById('back-to-list').addEventListener('click', closeRound);
    window.addEventListener('popstate', readUrl);
    onWidthChange(() => { if (state.roundId) renderRound(); });
    readUrl();
  } catch (err) {
    document.getElementById('app').prepend(errorBox(err.message));
    console.error(err);
  }
}

main();
