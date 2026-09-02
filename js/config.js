// サイト全体の設定。
//
// 利用者は選手とコーチ。表示モードの切替は持たない（Phase 1）。
// GitHub Pages 上の JSON・JavaScript は誰でも取得できるので、非公開前提の情報は
// ビルド成果物に含めないこと。

export const SITE_TITLE = 'モーグル リザルトデータベース';

// 誤り報告の送り先。メールアドレスを入れると「誤りを報告」が mailto: になる。
// 空のままなら GitHub の Issue 作成ページに送る（件名・本文は同じものを自動で入れる）。
// 収集ボット対策として分割して保持（表示時に結合）。
export const REPORT_EMAIL = ['yuyumogul', 'gmail.com'].join('@');
export const REPORT_ISSUES_URL = 'https://github.com/VanWhist/moguls-results/issues/new';

// 結果表の1ページあたりの行数。予選は 60 人前後なので 1 ページに収まるようにしておく。
export const RESULTS_PER_PAGE = 100;
