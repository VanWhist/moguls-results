// 画面まわりの小さな共通部品。フレームワークは使わない。
// trampo-results の js/ui.js を流用し、モーグル向けのラベル・数値部品を足している。

import { SITE_TITLE, REPORT_EMAIL, REPORT_ISSUES_URL } from './config.js';

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// ---- 数値 -----------------------------------------------------------------
// 取れなかった値は「0」ではなく空欄にする。推測で埋めない。
export function num(v, digits = 2) {
  if (v === null || v === undefined || v === '') return null;
  return Number(v).toFixed(digits);
}

export function cell(value, digits = 2, extraClass = '') {
  const text = num(value, digits);
  return el('td', {
    class: ('num ' + (text === null ? 'blank ' : '') + extraClass).trim(),
    text: text === null ? '—' : text,
  });
}

// 加減算は整数セント（Math.round(x*100)）で行う。浮動小数のまま引き算すると
// 0.1 + 0.2 のずれが表示に出る。
export function cents(x) {
  if (x === null || x === undefined || x === '') return null;
  return Math.round(Number(x) * 100);
}

export function fromCents(c, digits = 2) {
  return (c / 100).toFixed(digits);
}

// 差分を符号付きで表示する。+ は緑、− は赤、0 は灰色。
export function diffSpan(c, digits = 2) {
  if (c === null || c === undefined) return el('span', { class: 'diff-zero', text: '—' });
  const cls = c > 0 ? 'diff-pos' : c < 0 ? 'diff-neg' : 'diff-zero';
  const sign = c > 0 ? '+' : c < 0 ? '−' : '±';
  return el('span', { class: cls, text: sign + fromCents(Math.abs(c), digits) });
}

// ---- ラベル -----------------------------------------------------------------
export const SERIES_LABEL = { WC: 'ワールドカップ', WSC: '世界選手権', OWG: 'オリンピック' };
export const ROUND_LABEL = { Q: '予選', Q1: '予選1', Q2: '予選2', F1: '決勝1', F2: '決勝2', F3: '決勝3' };
export const FORMAT_LABEL = {
  wc_traditional: 'W杯 traditional（Q→F1 16名→F2 6名）',
  wc_phased: 'W杯 phased finals（Q1/Q2→F1 16名→F2 6名）',
  championship: 'championship（Q1/Q2→F1 20名→F2 8名）',
  owg_2022: '北京2022（Q1/Q2/F1/F2/F3）',
};
export const LAYER_LABEL = {
  layer0: '第0層 完全性（期待ラウンド一覧・人数・run_id 重複）',
  layer1: '第1層 二重読み取り（座標パーサと正規表現パーサの全項目一致）',
  layer2: '第2層 再計算（タイム点・エア・ターン・合計を規則から再計算）',
  layer3: '第3層 再構成（順位・タイブレーク・通過者の検算）',
  layer4: '第4層 横断整合（FISコード↔生年・氏名・国・審判・ペースタイム）',
  layer5: '第5層 外部照合（FIS サイトの結果と突き合わせ）',
  golden: '正解データ回帰（PDF を目視して作った golden/*.json との一致）',
};

// 層ごとの結果ラベル。第5層は FIS サイトとのネットワーク照合で、手動実行のときだけ ok になる。
export const LAYER_STATUS = {
  ok: '照合済み',
  skipped: '未実施（ネットワーク照合は手動実行）',
  error: '不一致',
  upstream_missing: 'FIS 側で元 PDF 未公開（既知の欠落）',
  partial: '一部のみ',
};

// 層の結果を印と色に。ok=✓緑、skipped=－灰、upstream_missing=△琥珀、それ以外=✗。
export function layerMark(s) {
  if (s === 'ok') return { mark: '✓ ', cls: 'verify-ok' };
  if (s === 'skipped') return { mark: '－ ', cls: 'meta' };
  if (s === 'upstream_missing') return { mark: '△ ', cls: 'verify-gap' };
  if (s === 'partial') return { mark: '△ ', cls: 'meta' };
  return { mark: '✗ ', cls: 'verify-ng' };
}
export function layerStatusLabel(s) {
  return LAYER_STATUS[s] || s || '—';
}

// events[].known_gaps = { "M": { "F2": "注記…" }, "W": {...} }（性別 → ラウンド → 日本語の注記）。
// 「FIS が審判別 PDF を公開していない」など、この DB に無いことが分かっているラウンド。
// 戻り値: { line: 一行表示, notes: [{ gender, round, note, text }] }。無ければ null。
export function knownGapsSummary(ev) {
  const gaps = (ev && ev.known_gaps) || {};
  const byRound = new Map();
  const notes = [];
  for (const [g, rounds] of Object.entries(gaps)) {
    for (const [rc, note] of Object.entries(rounds || {})) {
      if (!byRound.has(rc)) byRound.set(rc, []);
      byRound.get(rc).push(g);
      notes.push({ gender: g, round: rc, note, text: genderLabel(g) + ' ' + roundLabel(rc) + '：' + note });
    }
  }
  if (!notes.length) return null;
  const line = [...byRound.entries()]
    .map(([rc, gs]) => roundLabel(rc) + '（' + gs.map(genderLabel).join('・') + '）').join('、')
    + ': FIS が審判別 PDF を公開していないため未収録';
  return { line, notes };
}

// Q2 の PDF は1選手2段（Q2 の走りと Q1 の走り）。ETL は q_block を "Q1" / "Q2" で持ち、
// Q2 も走った選手の Q1 レコードは run_id に "-Q1ref" を付ける。ここではその両方を Q1 側として扱う。
export function isQ1Block(run) {
  return run.q_block === 'Q1' || run.q_block === 'Q1ref';
}
export function isQ1Ref(run) {
  return run.q_block === 'Q1ref' || /-Q1ref$/.test(run.run_id || '');
}

export function seriesLabel(s) { return SERIES_LABEL[s] || s || '—'; }
export function roundLabel(r) { return ROUND_LABEL[r] || r || '—'; }
export function genderLabel(g) {
  if (g === 'M') return '男子';
  if (g === 'W' || g === 'F' || g === 'L') return '女子';
  return g || '—';
}
// ETL が format_label を持っていればそれを使う。無ければここの表。
export function formatLabel(f, ev) {
  if (ev && ev.format_label) return ev.format_label;
  return FORMAT_LABEL[f] || f || '—';
}

// 大会の表示名。「2024-25 ワールドカップ RUKA (FIN)」
export function eventName(ev) {
  return ev.season + ' ' + seriesLabel(ev.series) + ' ' + ev.venue;
}

// 大会の日付範囲。ETL の date_from / date_to があればそれ、無ければラウンドの日付の最小〜最大。
export function eventDates(ev) {
  let from = ev.date_from, to = ev.date_to;
  if (!from || !to) {
    const ds = (ev.rounds || []).map((r) => r.date).filter(Boolean).sort();
    if (!ds.length) return '—';
    from = ds[0];
    to = ds[ds.length - 1];
  }
  return from === to ? from : from + ' 〜 ' + to;
}

// 検証結果の3値: 'ok'（全層 ok / skipped）、'gap'（upstream_missing あり＝FIS 未公開の既知の欠落）、'ng'（error など）。
export function verificationState(v) {
  if (!v) return 'ng';
  const vals = Object.values(v);
  if (vals.some((s) => !['ok', 'skipped', 'upstream_missing'].includes(s))) return 'ng';
  return vals.includes('upstream_missing') ? 'gap' : 'ok';
}
export function verificationOk(v) {
  return verificationState(v) === 'ok';
}
export function verificationBadge(v) {
  const st = verificationState(v);
  if (st === 'ok') return { text: '✓ FIS公式結果と照合済み', cls: 'verify-ok' };
  if (st === 'gap') return { text: '△ 一部未収録（FIS 未公開）', cls: 'verify-gap' };
  return { text: '⚠ 検証に未確認の層があります', cls: 'verify-ng' };
}

export function statusBadge(run) {
  const out = [];
  if (run.status && run.status !== 'OK') out.push(el('span', { class: 'badge status', text: run.status }));
  if (run.reserve_judge) out.push(el('span', { class: 'badge res', text: 'リザーブジャッジ採点', title: 'リザーブジャッジが採点したラン（PDF の RES 印）' }));
  return out;
}

// ---- 誤り報告リンク ----------------------------------------------------------
// 件名・本文に round_id と dataVersion を自動で入れる。受け取った側が対象を特定しやすい。
export function reportLink(ctx) {
  const subject = '[moguls-results] 誤り報告 ' + (ctx.round_id || ctx.run_id || '');
  const body = [
    'round_id: ' + (ctx.round_id || '—'),
    ctx.run_id ? 'run_id: ' + ctx.run_id : null,
    'dataVersion: ' + (ctx.dataVersion || '—'),
    ctx.pdf ? 'pdf: ' + ctx.pdf : null,
    'ページ: ' + location.href,
    '',
    '誤りの内容（どの選手・どの列・正しい値）:',
    '',
  ].filter((x) => x !== null).join('\n');
  let href;
  if (REPORT_EMAIL) {
    href = 'mailto:' + REPORT_EMAIL + '?subject=' + encodeURIComponent(subject)
      + '&body=' + encodeURIComponent(body);
  } else {
    href = REPORT_ISSUES_URL + '?title=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }
  return el('a', { href, target: REPORT_EMAIL ? null : '_blank', rel: 'noopener', text: '誤りを報告' });
}

// ---- ナビ -------------------------------------------------------------------
export function navbar(active) {
  const links = [
    ['index.html', 'リザルト'],
    ['athlete.html', '選手'],
    ['about.html', 'データについて'],
  ];
  return el('header', { class: 'site' }, [
    el('h1', { text: SITE_TITLE }),
    el('nav', {}, links.map(([href, label]) =>
      el('a', { href, class: href === active ? 'active' : '', text: label }))),
  ]);
}

export function mountNav(active) {
  document.body.prepend(navbar(active));
}

export function errorBox(message) {
  return el('div', { class: 'notice', text: 'データを読めませんでした：' + message });
}

// manifest.sample が true のときだけ出す注意書き。ETL が本番データを書くと消える。
export function sampleNotice(m) {
  if (!m || !m.sample) return null;
  return el('div', { class: 'notice', text: 'これはレイアウト確認用のサンプルデータです（dataVersion ' + m.dataVersion
    + '）。数値は実際の結果ではありません。' });
}

// 表のソート。全列クリックで昇順・降順を切り替える。
export function makeSortable(table, rows, render, initial) {
  let key = initial ? initial.key : null;
  let dir = initial ? initial.dir : 1;
  const heads = [...table.tHead.rows[table.tHead.rows.length - 1].cells];

  function apply() {
    if (key) {
      const sorted = [...rows].sort((a, b) => {
        const x = a[key], y = b[key];
        const xn = x === null || x === undefined || x === '';
        const yn = y === null || y === undefined || y === '';
        if (xn && yn) return 0;
        if (xn) return 1;              // 欠測は常に末尾
        if (yn) return -1;
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
        return String(x).localeCompare(String(y), 'ja') * dir;
      });
      render(sorted);
    } else {
      render(rows);
    }
    for (const h of heads) {
      const hk = h.dataset.key;
      if (!hk) continue;
      if (hk === key) h.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
      else h.removeAttribute('aria-sort');
    }
  }

  for (const h of heads) {
    if (!h.dataset.key) { h.classList.add('no-sort'); continue; }
    h.addEventListener('click', () => {
      if (key === h.dataset.key) dir = -dir;
      else { key = h.dataset.key; dir = h.dataset.numeric ? -1 : 1; }
      apply();
    });
  }
  apply();
  return { update(next) { rows = next; apply(); } };
}

// ---- ページング -------------------------------------------------------------
// 検索・絞り込み・ソートは常に全件を対象にし、表示だけを切り出す。
export const PER_PAGE = 50;

export function paginate(list, page, perPage = PER_PAGE) {
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * perPage;
  return {
    items: list.slice(start, start + perPage),
    page: current,
    pages,
    from: list.length ? start + 1 : 0,
    to: Math.min(start + perPage, list.length),
    total: list.length,
  };
}

/** 「62件　1–50件を表示　‹ 前へ 1 / 2 次へ ›」 */
export function renderPager(node, view, onGo) {
  clear(node);
  const n = (v) => v.toLocaleString('ja-JP');
  node.append(el('span', { class: 'pager-count' }, [
    el('strong', { text: n(view.total) + '件' }),
    document.createTextNode(view.total
      ? '　' + n(view.from) + '–' + n(view.to) + '件を表示'
      : '　該当なし'),
  ]));
  if (view.pages <= 1) return;
  node.append(el('span', { class: 'pager-nav' }, [
    el('button', { class: 'chip', text: '‹ 前へ', disabled: view.page <= 1,
      onclick: () => onGo(view.page - 1) }),
    el('span', { class: 'pager-pos', text: view.page + ' / ' + view.pages }),
    el('button', { class: 'chip', text: '次へ ›', disabled: view.page >= view.pages,
      onclick: () => onGo(view.page + 1) }),
  ]));
}

// ---- 狭い画面ではカード表示に切り替える -------------------------------------
// 表の横スクロールは最終手段。1件＝1カードにして、主な情報だけを大きく出す。
const NARROW = window.matchMedia('(max-width: 700px)');

export function isNarrow() {
  return NARROW.matches;
}

export function onWidthChange(fn) {
  const handler = () => fn(NARROW.matches);
  if (NARROW.addEventListener) NARROW.addEventListener('change', handler);
  else NARROW.addListener(handler);
}

// ---- 注記の3層構造 -----------------------------------------------------------
// 注記は消さない。毎回全文を通過させるのをやめるだけ。
//   第1層 … 一行だけ常時表示
//   第2層 … クリックで展開
//   第3層 … 「データについて」ページ
export function noteLayers(headline, detailNodes, aboutAnchor) {
  const body = el('div', { class: 'note-body', hidden: true }, detailNodes);
  const toggle = el('button', {
    class: 'link-button', text: '詳しく見る',
    onclick: () => {
      body.hidden = !body.hidden;
      toggle.textContent = body.hidden ? '詳しく見る' : '閉じる';
    },
  });
  return el('div', { class: 'note' }, [
    el('div', { class: 'note-head' }, [
      el('span', { class: 'note-icon', text: 'ⓘ' }),
      el('span', { text: headline }),
      toggle,
      aboutAnchor === false ? null
        : el('a', { class: 'note-more', href: 'about.html', text: 'データについて' }),
    ]),
    body,
  ]);
}

// ---- 選手検索 ---------------------------------------------------------------
// 氏名（FIS 表記のローマ字）と別名（漢字・かな）の両方に部分一致させる。
export function athleteMatches(a, q) {
  const s = q.toLowerCase();
  if ((a.name || '').toLowerCase().includes(s)) return true;
  if ((a.fis_code || '') === q) return true;
  return (a.aliases || []).some((n) => String(n).toLowerCase().includes(s));
}

export function athleteHref(id) {
  return 'athlete.html?fis=' + encodeURIComponent(id);
}
