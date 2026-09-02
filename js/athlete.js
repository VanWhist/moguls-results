// ページ② 選手。athlete.html?fis=<FISコード>。
//
// 基本情報・自己ベスト・出場履歴に加えて、Phase 1 の主役である
// 「ランの内訳と上のラインとの差」「ジャンプ構成の推移」「点の経済学」を出す。
// 差の計算は整数セント（Math.round(x*100)）で行い、表示だけ toFixed(2) にする。

import * as data from './data.js';
import {
  el, clear, cell, num, cents, fromCents, diffSpan, mountNav, errorBox, isNarrow, onWidthChange,
  sampleNotice, roundLabel, genderLabel, eventName, statusBadge, athleteMatches, athleteHref, isQ1Ref,
} from './ui.js';
import { timePointsCents, airTotalCents, ddBreakEven } from './scoring.js';

// Q2 ファイルの段（Q1参考 / Q1 / Q2）の表示名。通常ラウンドは null。
function blockLabel(run) {
  if (!run.q_block) return null;
  return isQ1Ref(run) ? 'Q1参考' : run.q_block;
}

function blockBadge(run) {
  const label = blockLabel(run);
  if (!label) return null;
  return el('span', { class: 'badge ' + (run.counting ? 'official' : 'plain'), text: ' ' + label + (run.counting ? '（採用）' : '') });
}

let athletes = [];
let runs = [];
let rounds = new Map();     // round_id → { event, round }
let lines = new Map();      // round_id → line
let manifest = null;

// ---- 検索 -------------------------------------------------------------------

function renderSearch(query) {
  const box = clear(document.getElementById('results'));
  if (!query) {
    box.append(el('p', { class: 'meta', text: '選手名を入力してください（部分一致）。' }));
    return;
  }
  const hits = athletes.filter((a) => athleteMatches(a, query));
  if (!hits.length) {
    box.append(el('p', { class: 'meta', text: '該当する選手がいません。' }));
    return;
  }
  box.append(el('p', { class: 'meta', text: hits.length + ' 名' }));
  box.append(el('div', { class: 'table-wrap' }, el('table', {}, [
    el('thead', {}, el('tr', {}, [
      el('th', { class: 'no-sort', text: '選手' }),
      el('th', { class: 'no-sort', text: 'NOC' }),
      el('th', { class: 'no-sort num', text: '生年' }),
      el('th', { class: 'no-sort', text: '別名' }),
      el('th', { class: 'no-sort num', text: 'ラン' }),
      el('th', { class: 'no-sort num', text: '自己ベスト' }),
    ])),
    el('tbody', {}, hits.slice(0, 200).map((a) => el('tr', {}, [
      el('td', {}, el('a', { href: athleteHref(a.athlete_id), text: a.name })),
      el('td', { text: a.noc || '—' }),
      el('td', { class: 'num', text: a.yb ?? '—' }),
      el('td', { class: 'meta', text: (a.aliases || []).join('・') || '—' }),
      el('td', { class: 'num', text: a.n_runs ?? '—' }),
      cell(a.best ? a.best.run_score : null, 2),
    ]))),
  ])));
}

// ---- 並び・集計 ---------------------------------------------------------------

function roundOf(run) {
  return rounds.get(run.round_id) || { event: null, round: null };
}

function sortKey(run) {
  const { round } = roundOf(run);
  return (run.date || (round && round.date) || '') + ' ' + ((round && round.start_time) || '') + ' ' + (isQ1Ref(run) ? '0' : '1');
}

function newestFirst(list) {
  return [...list].sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0));
}

function isScored(run) {
  return run.status === 'OK' && run.run_score !== null && run.run_score !== undefined && run.counting !== false;
}

function bestOf(list, key) {
  let best = null;
  for (const r of list) {
    if (r[key] === null || r[key] === undefined) continue;
    if (!best || r[key] > best[key]) best = r;
  }
  return best;
}

function runTitle(run) {
  const { event, round } = roundOf(run);
  const ev = event ? eventName(event) : run.event_id;
  const rd = round ? genderLabel(round.gender) + ' ' + roundLabel(round.round) : run.round;
  const block = blockLabel(run);
  return (run.date || (round && round.date) || '—') + '　' + ev + '　' + rd + (block ? '（' + block + '）' : '');
}

function roundHref(run) {
  return 'index.html?event=' + encodeURIComponent(run.event_id) + '&round=' + encodeURIComponent(run.round_id);
}

// ---- 基本情報・自己ベスト ------------------------------------------------------

function renderProfile(a, mine) {
  const box = clear(document.getElementById('profile'));
  const sn = sampleNotice(manifest);
  if (sn) box.append(sn);
  box.append(el('h2', { text: a.name }));
  box.append(el('p', { class: 'meta', text: 'NOC ' + (a.noc || '—') + '　生年 ' + (a.yb ?? '—') + '　FIS コード ' + (a.fis_code || a.athlete_id)
    + '　シーズン ' + ((a.seasons || []).join('・') || '—') }));
  if (a.aliases && a.aliases.length) {
    box.append(el('p', { class: 'meta', text: '別名：' + a.aliases.join('、') + '（検索に使えます）' }));
  }
  const hist = a.noc_history || [];
  if (hist.length > 1) {
    box.append(el('p', { class: 'meta', text: '国の履歴：' + hist.map((h) => h.noc + '（' + h.from + '〜' + h.to + '）').join(' → ') }));
  }

  const scored = mine.filter(isScored);
  const bests = [
    ['合計', 'run_score', 2], ['タイム点', 'time_points', 2], ['エア', 'air_total', 2],
    ['ターン', 'turns_total', 1], ['ベース', 'base_total', 1], ['減点', 'ded_total', 1],
  ];
  box.append(el('h3', { text: '自己ベスト' }));
  box.append(el('div', { class: 'kv' }, [
    el('div', {}, [el('div', { class: 'k', text: '出場ラン' }), el('div', { class: 'v', text: mine.length })]),
    ...bests.map(([label, key, digits]) => {
      const b = bestOf(scored, key);
      const { round } = b ? roundOf(b) : {};
      return el('div', { title: b ? runTitle(b) : null }, [
        el('div', { class: 'k', text: label }),
        el('div', { class: 'v', text: b ? num(b[key], digits) : '—' }),
        b ? el('div', { class: 'meta small', text: (round && round.date) || '' }) : null,
      ]);
    }),
  ]));
  if (!scored.length) {
    box.append(el('p', { class: 'meta', text: '得点のあるランがありません。' }));
  } else {
    box.append(el('p', { class: 'meta', text: '自己ベストは採用されたラン（Q1参考を除く）のうち、要素ごとの最高値です。同じランとは限りません。' }));
  }
}

// ---- 出場履歴 -----------------------------------------------------------------

function renderHistory(mine) {
  const wrap = clear(document.getElementById('history'));
  const list = newestFirst(mine);
  const rankText = (r) => (r.rank ? r.rank + '位' : (r.status && r.status !== 'OK' ? r.status : '—'));
  const desc = document.querySelector('#history-card p.meta');
  if (desc) {
    desc.textContent = isNarrow()
      ? '新しい順。カードを押すと、そのランの内訳（通過ライン・1位との差、点の経済学）が開きます。'
      : '新しい順。ラウンド名を押すと、そのラウンドの結果表へ移動します。';
  }
  if (isNarrow()) {
    // スマホ：1ラン1カード。1行目 日付・大会・ラウンド・順位・得点、2行目 タイム点/エア/ターン。
    // 押すとそのランの内訳と点の経済学が開く。既定で開くのは最新の（得点のある）ランだけ。
    const firstDetail = list.find(hasDetail);
    wrap.append(el('div', { class: 'card-list' }, list.map((r) => {
      const { event, round } = roundOf(r);
      const roundName = round ? genderLabel(round.gender) + ' ' + roundLabel(round.round) : r.round;
      const summaryBody = [
        el('div', { class: 'hist-l1' }, [
          el('span', { class: 'hist-date', text: r.date || (round && round.date) || '—' }),
          el('span', { class: 'hist-event', text: event ? eventName(event) : r.event_id }),
          el('span', { class: 'hist-round' }, [roundName, blockBadge(r)]),
          el('span', { class: 'hist-rank', text: isQ1Ref(r) ? '' : rankText(r) }),
          ...statusBadge(r),
          el('span', { class: 'hist-score', text: num(r.run_score, 2) ?? '—' }),
        ]),
        el('div', { class: 'hist-l2' }, [
          ['タイム点', num(r.time_points, 2)], ['エア', num(r.air_total, 2)], ['ターン', num(r.turns_total, 1)],
        ].map(([k, v]) => el('span', {}, [k + ' ', el('b', { text: v ?? '—' })]))),
      ];
      const goRound = el('p', { class: 'hist-go' }, el('a', { href: roundHref(r), text: 'このラウンドの結果表を見る →' }));
      if (!hasDetail(r)) {
        return el('article', { class: 'hist' + (isQ1Ref(r) ? ' qref' : '') }, [
          el('div', { class: 'hist-static' }, [...summaryBody, goRound]),
        ]);
      }
      return el('details', { class: 'hist' + (isQ1Ref(r) ? ' qref' : ''), open: r === firstDetail ? '' : null }, [
        el('summary', {}, summaryBody),
        el('div', { class: 'hist-body' }, [goRound, ...runDetail(r)]),
      ]);
    })));
    return;
  }
  wrap.append(el('div', { class: 'table-wrap' }, el('table', {}, [
    el('thead', {}, el('tr', {}, ['大会日', '大会', 'ラウンド', '順位', '合計', 'タイム点', 'エア', 'ターン', 'ベース', '減点', 'タイム(s)', '状態']
      .map((t, i) => el('th', { class: 'no-sort' + (i >= 3 && i <= 10 ? ' num' : ''), text: t })))),
    el('tbody', {}, list.map((r) => {
      const { event, round } = roundOf(r);
      return el('tr', { class: (isQ1Ref(r) ? 'qref' : '') + (r.q_block && r.counting ? ' counting' : '') }, [
        el('td', { text: r.date || (round && round.date) || '—' }),
        el('td', { text: event ? eventName(event) : r.event_id }),
        el('td', {}, [
          el('a', { href: roundHref(r), text: round ? genderLabel(round.gender) + ' ' + roundLabel(round.round) : r.round }),
          blockBadge(r),
        ]),
        el('td', { class: r.rank ? 'num' : 'num blank', text: isQ1Ref(r) ? '' : (r.rank ?? '—') }),
        cell(r.run_score, 2), cell(r.time_points, 2), cell(r.air_total, 2), cell(r.turns_total, 1),
        cell(r.base_total, 1), cell(r.ded_total, 1), cell(r.seconds, 2),
        el('td', {}, statusBadge(r).length ? statusBadge(r) : el('span', { class: 'meta', text: r.status || '—' })),
      ]);
    })),
  ])));
}

// ---- ランの内訳と上のラインとの差 ---------------------------------------------
// 差 = このラン − 相手。整数セントで引き算してから表示する。

function diffCell(mineV, otherV, digits = 2) {
  const a = cents(mineV), b = cents(otherV);
  if (a === null || b === null) return el('td', { class: 'num blank', text: '—' });
  return el('td', { class: 'num' }, diffSpan(a - b, digits));
}

// 広い画面と狭い画面で表記を切り替えるラベル（CSS の .lbl-w / .lbl-n）。狭い画面では 360px に収める
function wideNarrow(wide, narrow) {
  return [el('span', { class: 'lbl-w', text: wide }), el('span', { class: 'lbl-n', text: narrow })];
}

function refName(summary) {
  return summary ? (summary.rank ? summary.rank + '位 ' : '') + (summary.name || '') : '';
}

function lineRef(summary, wide, narrow, emptyNote) {
  if (!summary) {
    return el('span', {}, [el('div', {}, wideNarrow(wide, narrow)), el('div', { class: 'meta small', text: emptyNote || '—' })]);
  }
  // 相手の名前は広い画面だけ見出しに出す。狭い画面では表の下に一行でまとめる（列幅を守るため）
  return el('span', {}, [
    el('div', {}, wideNarrow(wide, narrow)),
    el('div', { class: 'meta small lbl-w', text: refName(summary) }),
  ]);
}

function breakdownTable(run, line) {
  const cut = line && line.cut ? line.cut.run : null;
  const winner = line ? line.winner : null;
  const cutLabel = line && line.cut ? line.cut.label || '通過ライン' : '通過ライン';
  const rows = [
    ['タイム点', 'time_points', 2], ['エア', 'air_total', 2], ['ターン', 'turns_total', 1],
    ['　ベース', 'base_total', 1], ['　減点による得点差', 'ded_total', 1, '　減点'], ['合計', 'run_score', 2],
  ];
  const names = [cut ? cutLabel + '：' + refName(cut) : null, winner ? '1位：' + refName(winner) : null].filter(Boolean);
  return el('div', {}, [el('div', { class: 'table-wrap' }, el('table', { class: 'mini' }, [
    el('thead', {}, el('tr', {}, [
      el('th', { class: 'no-sort', text: '要素' }),
      el('th', { class: 'no-sort num' }, wideNarrow('このラン', '自分')),
      el('th', { class: 'no-sort num' }, lineRef(cut, cutLabel, 'ライン', line && !line.cut ? 'なし（最終ラウンド）' : '未登録')),
      el('th', { class: 'no-sort num', text: '差' }),
      el('th', { class: 'no-sort num' }, lineRef(winner, '同ラウンド1位', '1位')),
      el('th', { class: 'no-sort num', text: '差' }),
    ])),
    el('tbody', {}, rows.map(([label, key, digits, short]) => el('tr', { class: key === 'run_score' ? 'counting' : '' }, [
      el('td', {}, short ? wideNarrow(label, short) : label),
      cell(run[key], digits),
      cell(cut ? cut[key] : null, digits),
      cut ? diffCell(run[key], cut[key], digits) : el('td', { class: 'num blank', text: line && !line.cut ? '最終' : '—' }),
      cell(winner ? winner[key] : null, digits),
      winner ? diffCell(run[key], winner[key], digits) : el('td', { class: 'num blank', text: '—' }),
    ]))),
  ])),
  names.length ? el('p', { class: 'meta small narrow-only', text: names.join('　') }) : null,
  el('p', { class: 'meta small', text: '差はすべて「このラン − 相手」。＋ は自分が上、− は自分が下（減点も同じ向き）。' })]);
}

// 点の経済学。FIS の採点式（切り捨て・上限込み）をこのランの数値で実際に計算した差。
// 閉じた式（32×0.1÷ペース など）は使わない。
function signedCents(c) {
  return (c > 0 ? '+' : c < 0 ? '−' : '±') + fromCents(Math.abs(c));
}

function economics(run) {
  const { round } = roundOf(run);
  const box = el('div', { class: 'econ' });
  box.append(el('h4', { text: '点の経済学（このランの数値で FIS の採点式をそのまま再計算）' }));

  const pace = round ? round.pace_time : null;
  const sec = run.seconds;
  if (pace && sec !== null && sec !== undefined) {
    const cur = timePointsCents(sec, pace);
    if (cur >= 2000) {
      box.append(el('p', {}, [el('strong', { text: '上限 20 点に達しているため増えません' }),
        '（このランの ' + sec.toFixed(2) + ' 秒で既にタイム点 20.00）。']));
    } else {
      for (const d of [0.1, 0.5]) {
        const s2 = Math.round((sec - d) * 100) / 100;
        const tp2 = timePointsCents(s2, pace);
        box.append(el('p', {}, [
          'タイム ' + d.toFixed(1) + ' 秒縮めると ', el('strong', { text: signedCents(tp2 - cur) + ' 点' }),
          '（このランの ' + sec.toFixed(2) + ' 秒 → ' + s2.toFixed(2) + ' 秒で再計算'
            + (tp2 >= 2000 ? '。上限 20 点で頭打ち' : '') + '）',
        ]));
      }
    }
    box.append(el('p', { class: 'formula', text: 'タイム点 = 48 − 32 × タイム ÷ ペースタイム ' + num(pace, 2)
      + '（小数第2位切り捨て、0〜20）。このラン ' + fromCents(cur) + ' 点。' }));
  } else {
    box.append(el('p', { class: 'meta', text: 'タイムかペースタイムが無いのでタイムの換算は出せません。' }));
  }

  box.append(el('p', { text: '採点に入る 3 名のベース点がそれぞれ 0.1 上がると +0.30 点'
    + '（1 名だけ 0.1 上がっても、その審判が最高・最低として除外されれば 0 点）。減点も同じ仕組みです。' }));

  const air = run.air || [];
  if (!air.length || airTotalCents(air) === null) {
    box.append(el('p', { class: 'meta', text: 'エアの記録が無い（または J6/J7・DD が欠けている）ので DD の損益分岐は出せません。' }));
    return box;
  }
  air.forEach((a, i) => {
    const be = ddBreakEven(air, i);
    const marks = (j6, j7) => num(j6, 1) + '/' + num(j7, 1);
    const head = (i + 1) + '本目 ' + (a.jump || '—') + '：DD を ' + num(a.dd, 2) + ' → ' + num(be.ddNew, 2) + ' に上げた場合、';
    box.append(el('p', {}, [
      head,
      be.steps > 0
        ? el('span', {}, ['J6/J7 が ' + marks(a.J6, a.J7) + ' → ', el('strong', { text: marks(be.J6, be.J7) }),
          ' まで落ちても合計は下がりません'])
        : el('span', {}, ['J6/J7（' + marks(a.J6, a.J7) + '）を 0.1 でも下げると合計が下がります']),
      '（実施そのままなら ' + signedCents(be.gain) + ' 点）。',
      be.capped ? el('span', { class: 'formula', text: '　※ 1 ジャンプ上限 10.00 に当たっています。' }) : null,
    ]));
  });
  box.append(el('p', { class: 'formula', text: 'エア = ジャッジごとに 点 × DD を切り捨て（上限 10.00）→ J6・J7 を平均 → 全ジャンプを足して切り捨て。'
    + ' このランのエア ' + fromCents(airTotalCents(air)) + '（印字 ' + (num(run.air_total, 2) ?? '—') + '）。' }));
  return box;
}

function renderBreakdown(mine) {
  const desc = document.querySelector('#breakdown-card p.meta');
  if (desc) desc.textContent = '各ランを、同じラウンドの通過ライン（最下位通過者）と同ラウンド1位（Q2 では大会の優勝者ではなく、その表の 1 位）に対して、タイム点・エア・ターン（ベース／減点）に分けて比べます。差は「このラン − 相手」です。';
  const box = clear(document.getElementById('breakdown'));
  const list = newestFirst(mine).filter((r) => r.status === 'OK' && r.run_score !== null && r.run_score !== undefined);
  if (!list.length) {
    box.append(el('p', { class: 'meta', text: '得点のあるランがありません。' }));
    return;
  }
  list.forEach((r, i) => {
    const d = el('details', { class: 'breakdown', open: i === 0 ? '' : null }, [
      el('summary', {}, [
        runTitle(r) + ' ',
        el('span', { class: 'bd-sub', text: (r.rank ? r.rank + '位　' : '') + (num(r.run_score, 2) ?? '—') + ' 点'
          + (r.q_block ? (r.counting ? '　採用' : '　不採用') : '') }),
      ]),
      ...runDetail(r),
    ]);
    box.append(d);
  });
}

// 1ラン分の内訳（基準線との差の表・ジャンプ・点の経済学）。
// 広い画面では「ランの内訳と上のラインとの差」カードに、狭い画面では出場履歴カードの中に出す。
function hasDetail(r) {
  return r.status === 'OK' && r.run_score !== null && r.run_score !== undefined;
}

function runDetail(r) {
  const line = lines.get(r.round_id) || null;
  return [
    line ? null : el('p', { class: 'meta', text: 'このラウンドの基準線（通過ライン・同ラウンド1位）はまだありません。' }),
    breakdownTable(r, line),
    line && line.cut ? el('p', { class: 'meta small', text: cutNote(line) }) : null,
    el('p', { class: 'meta small', text: 'ジャンプ：' + (r.air || []).map((a) => (a.jump || '—') + ' DD ' + (num(a.dd, 2) ?? '—')
      + '（J6 ' + (num(a.J6, 1) ?? '—') + ' / J7 ' + (num(a.J7, 1) ?? '—') + '）').join('、') }),
    economics(r),
  ];
}

function cutNote(line) {
  const n = line.n_advance ?? line.cut.rank;
  const nOk = line.n_ok !== undefined ? '　得点のある走者 ' + line.n_ok + ' 名' : '';
  return (line.cut.label || '通過ライン') + ' ＝ ' + line.cut.rank + '位（通過 ' + n + ' 名' + nOk
    + '）の得点。差がプラスならライン上、マイナスならライン下。';
}

// ---- ジャンプ構成の推移 --------------------------------------------------------

function renderJumps(mine) {
  const box = clear(document.getElementById('jumps'));
  const list = newestFirst(mine).reverse().filter((r) => (r.air || []).length);   // 古い順
  if (!list.length) {
    box.append(el('p', { class: 'meta', text: 'エアの記録がありません。' }));
    return;
  }
  const mean = (a) => (a.J6 === null || a.J6 === undefined || a.J7 === null || a.J7 === undefined)
    ? null : ((cents(a.J6) + cents(a.J7)) / 200).toFixed(2);
  const jumpCells = (a) => a
    ? [el('td', { text: a.jump || '—' }), cell(a.dd, 2), el('td', { class: mean(a) === null ? 'num blank' : 'num', text: mean(a) ?? '—' })]
    : [el('td', { class: 'blank', text: '—' }), el('td', { class: 'num blank', text: '—' }), el('td', { class: 'num blank', text: '—' })];
  box.append(el('div', { class: 'table-wrap' }, el('table', { class: 'mini' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { class: 'grp no-sort', colspan: 3, text: '' }),
        el('th', { class: 'grp no-sort sep', colspan: 3, text: '1本目' }),
        el('th', { class: 'grp no-sort sep', colspan: 3, text: '2本目' }),
        el('th', { class: 'grp no-sort', text: '' }),
      ]),
      el('tr', {}, ['大会日', '大会', 'ラウンド', 'ジャンプ', 'DD', '実施点', 'ジャンプ', 'DD', '実施点', 'エア合計']
        .map((t, i) => el('th', { class: 'no-sort' + ([4, 5, 7, 8, 9].includes(i) ? ' num' : '') + ([3, 6].includes(i) ? ' sep' : ''), text: t }))),
    ]),
    el('tbody', {}, list.map((r) => {
      const { event, round } = roundOf(r);
      const block = blockLabel(r);
      return el('tr', { class: isQ1Ref(r) ? 'qref' : '' }, [
        el('td', { text: r.date || (round && round.date) || '—' }),
        el('td', { text: event ? eventName(event) : r.event_id }),
        el('td', { text: (round ? genderLabel(round.gender) + ' ' + roundLabel(round.round) : r.round) + (block ? '（' + block + '）' : '') }),
        ...jumpCells(r.air[0]), ...jumpCells(r.air[1]),
        cell(r.air_total, 2),
      ]);
    })),
  ])));
  box.append(el('p', { class: 'meta small', text: '実施点は J6・J7 の平均（DD を掛ける前）。' }));
}

// ---- ルーティング ------------------------------------------------------------

function renderAthlete(id) {
  const a = athletes.find((x) => x.athlete_id === id || x.fis_code === id);
  const profile = clear(document.getElementById('profile'));
  if (!a) {
    profile.append(el('p', { class: 'meta', text: '選手が見つかりません（FIS コード ' + id + '）。' }));
    for (const c of ['history-card', 'breakdown-card', 'jumps-card']) document.getElementById(c).hidden = true;
    return;
  }
  document.title = a.name + ' | モーグル リザルトデータベース';
  const mine = runs.filter((r) => r.athlete_id === a.athlete_id || r.fis_code === a.fis_code);
  renderProfile(a, mine);
  renderHistory(mine);
  renderBreakdown(mine);
  renderJumps(mine);
  for (const c of ['history-card', 'breakdown-card', 'jumps-card']) document.getElementById(c).hidden = false;
  // 狭い画面では内訳・点の経済学を出場履歴カードの中に出すので、同じ内容の別カードは畳む
  document.getElementById('breakdown-card').hidden = isNarrow();
}

function route() {
  const id = new URL(location.href).searchParams.get('fis') || location.hash.replace(/^#/, '');
  document.getElementById('search-card').hidden = !!id;
  document.getElementById('athlete-card').hidden = !id;
  if (id) renderAthlete(id);
  else for (const c of ['history-card', 'breakdown-card', 'jumps-card']) document.getElementById(c).hidden = true;
}

async function main() {
  mountNav('athlete.html');
  try {
    const [as, rs, ri, lm, mf] = await Promise.all([
      data.athletes(), data.allRuns(), data.roundIndex(), data.lineMap(), data.manifest(),
    ]);
    athletes = as;
    runs = rs;
    rounds = ri;
    lines = lm;
    manifest = mf;
    const q = document.getElementById('q');
    q.addEventListener('input', () => renderSearch(q.value.trim()));
    window.addEventListener('popstate', route);
    window.addEventListener('hashchange', route);
    onWidthChange(() => route());     // 表↔カードの切り替え
    renderSearch('');
    route();
  } catch (err) {
    document.getElementById('app').prepend(errorBox(err.message));
    console.error(err);
  }
}

main();
