// FIS モーグルの採点式（整数セント）。
// 「点の経済学」は閉じた式（32×0.1÷ペース など）ではなく、実際の切り捨て・上限をそのまま
// 計算した差で出す。浮動小数の丸めを避けるため、点は 0.1 単位、DD は 0.01 単位の整数で扱う。

// タイム点 = trunc2(48 − 32 × タイム ÷ ペースタイム)、0〜20 にクランプ。セントで返す。
export function timePointsCents(seconds, pace) {
  if (seconds === null || seconds === undefined || !pace) return null;
  const c = Math.floor((48 - 32 * seconds / pace) * 100 + 1e-7);
  return Math.max(0, Math.min(2000, c));
}

// ジャッジ1名分: 点 × DD を小数第2位で切り捨て、上限 10.00。セントで返す。
export function judgeValueCents(mark, dd) {
  const j10 = Math.round(mark * 10);
  const dd100 = Math.round(dd * 100);
  return Math.min(1000, Math.floor(j10 * dd100 / 10));
}

// 1ジャンプ = J6・J7 の平均（ここでは切り捨てない。x.5 セントになりうる）
export function jumpCents(j) {
  return (judgeValueCents(j.J6, j.dd) + judgeValueCents(j.J7, j.dd)) / 2;
}

// エア合計 = 全ジャンプの合計を小数第2位で切り捨て。欠測があれば null。
export function airTotalCents(jumps) {
  let s = 0;
  for (const j of jumps || []) {
    if (j.J6 === null || j.J6 === undefined || j.J7 === null || j.J7 === undefined
      || j.dd === null || j.dd === undefined) return null;
    s += jumpCents(j);
  }
  return Math.floor(s + 1e-7);
}

// DD を ddStep 上げたとき、J6/J7 をそろって 0.1 ずつ下げていき（差は保つ）、
// エア合計が今の値を下回らない最低の点を探す。他のジャンプはそのまま。
// 戻り値: { ddNew, gain（実施そのままの増分, セント）, steps, J6, J7, capped }
export function ddBreakEven(jumps, i, ddStep = 0.17) {
  const j = jumps[i];
  const ddNew = Math.round((j.dd + ddStep) * 100) / 100;
  const cur = airTotalCents(jumps);
  const j6 = Math.round(j.J6 * 10);
  const j7 = Math.round(j.J7 * 10);
  const withLower = (k) => airTotalCents(jumps.map((x, n) => (n === i
    ? { J6: (j6 - k) / 10, J7: (j7 - k) / 10, dd: ddNew } : x)));
  const gain = withLower(0) - cur;
  // 点を下げるほど合計は単調に下がるので、最初に下回った所で止める
  let best = 0;
  for (let k = 1; j6 - k >= 0 && j7 - k >= 0; k++) {
    if (withLower(k) >= cur) best = k;
    else break;
  }
  return {
    ddNew, gain, steps: best,
    J6: (j6 - best) / 10, J7: (j7 - best) / 10,
    capped: judgeValueCents(j.J6, ddNew) >= 1000 || judgeValueCents(j.J7, ddNew) >= 1000,
  };
}
