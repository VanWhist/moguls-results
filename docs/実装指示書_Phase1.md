# moguls-results 実装指示書（Phase 1）

作成日: 2026-09-03
決定事項の出典: Van さんとの相談（2026-09-02〜03）、ChatGPT レビュー「データ検証方式レビュー」（2026-09-03）

## 0. 目的と範囲

FIS 公式リザルト PDF（W杯・世界選手権・オリンピック、モーグル単走）を読み取り、選手とコーチが
いつでも見られるリザルトデータベースを作る。ジャッジ分析の画面は Phase 1 では作らないが、
データは将来のジャッジ分析（ラン × 審判の生点、除外フラグ、審判 ID）とステノシート（ラン × 審判 × 要素）を
受け入れられる形で持つ。

| 項目 | 決定 |
|---|---|
| 利用者 | 選手とコーチ。表示モード切替なし |
| 形態 | GitHub Pages 静的サイト。Python ETL が PDF を直接読んで JSON 生成。ログインなし |
| 公開 | 公開リポジトリ `VanWhist/moguls-results`、`robots.txt` と `noindex` で検索除外 |
| 対象大会 | W杯・世界選手権・オリンピック（`series` 区分を持ち、COC 等は後から追加可能） |
| 対象種目 | 単走（予選・Q1・Q2・決勝1・決勝2）。デュアルモーグルは対象外（保持もしない） |
| Phase 1 に含める拡張 | Q1/Q2 二段レイアウト（7ファイル）のパーサ対応 |
| 画面 | ①リザルト ②選手 ③データについて。ジャッジ分析・国籍の軸は作らない |
| 元データ | `D:\Claude\ジャッジ分析\全試合のリザルト\`（読むだけ。書き換えない） |
| 見た目 | trampo-results に揃える（css/style.css と js/ui.js の流用） |

## 1. 画面

### ①リザルト（index.html）
- 上部に大きな検索窓（選手名・大会名。日本人選手は漢字・かなの別名でも引ける）。候補即時表示 → 選手ページへ。
- 初期表示は「最近の大会」カード（大会名・日付・会場・男女・ラウンド）。
- 大会 → ラウンドを開くと結果表: Rank / Bib / Name / NOC / Time(s) / Time Pts / Air J6 J7 Jump DD ×2 / Air Total /
  Base J1〜J5 / Base Total / Ded J1〜J5 / Ded Total / Turns / Score / Tie / Status。除外された点は薄く表示。
- 各行から「元 PDF を見る」（FIS 上の PDF URL、無ければローカル名を表示）。
- ラウンド見出しに「✓ FIS公式結果と照合済み」。押すと検証項目一覧・元 PDF・誤り報告リンク。
- 狭い画面ではカード表示（大会・順位・合計を主、内訳を従）。

### ②選手（athlete.html?fis=XXXXXXX）
- 基本情報（氏名・国・生年・FIS コード・別名）。
- 出場履歴（新しい順）: 大会・ラウンド・順位・合計・タイム点・エア・ターン。
- **ランの内訳と上のラインとの差**（Phase 1 の主役）: 各ランについて「同ラウンドの通過ライン（Q→F1 の最下位通過者、
  F1→F2 の最下位通過者）」「優勝者」との差を、タイム点・エア・ターン（ベース／減点）に分解して表示。
  通過ラインは大会フォーマット（規則版）から決める。
- **ジャンプ構成の推移**: ジャンプコードと DD、実施点（J6/J7 平均）の時系列。
- **点の経済学**（規則からの一般則。審判に依存しない）: このランの条件で「タイム0.1秒＝何点」「ベース点0.1＝0.3点」
  「DD を上げたときの損益分岐（実施点をいくつ落とすと消えるか）」を、そのランの数値で計算して表示。
- 自己ベスト（合計・各要素）。

### ③データについて（about.html）
- 出典、対象大会、対象外（デュアル）、欠測の定義（DNF/DNS/DSQ/RES）、検証の仕組み（多層照合の説明）、
  データ版・更新日、規則版の一覧、誤りの報告先。

## 2. データ（`data/`）

数値は JSON では number（小数2桁を超えない）。UI 側の加減算は `Math.round(x*100)` の整数で行い、
表示は `toFixed(2)`。ファイル名は内容ハッシュ付き（`runs.2025-26.a1b2c3.json`）で、`manifest.json` が対応表。

### manifest.json
```
{ "dataVersion": "2026-09-03-01", "builtAt": "...", "parserVersion": "...",
  "files": { "events": "events.<hash>.json", "athletes": "...", "runs": {"2022-23": "...", ...}, "lines": "...", "rules": "..." },
  "counts": {"events": n, "rounds": n, "runs": n, "athletes": n},
  "verification": { "allGreen": true, "layers": {...}, "reportPath": "docs/検証レポート.md" } }
```

### events.<hash>.json — 大会 × ラウンド
```
{ "event_id": "2025-26-ruka-8105",            // season-venueslug-codex（男女で codex が違うので codex は round 側にも持つ）
  "season": "2025-26", "series": "WC" | "WSC" | "OWG", "venue": "RUKA (FIN)", "nation": "FIN",
  "format": "wc_traditional" | "wc_phased" | "championship" | "owg_2022",
  "rounds": [ { "round_id": "2025-26-8105-F2", "codex": "8105", "gender": "M", "round": "F2",
                "date": "2024-11-30", "start_time": "16:48", "n_competitors": 6,
                "pace_time": 20.38, "course": {"name": "Battery Run", "length_m": 210, "width_m": 18.0, "gate_width_m": 10.0, "gradient_deg": 27},
                "judges": [ {"no": 1, "role": "Turns", "judge_id": "j-orsatti-alberto", "name": "ORSATTI Alberto", "noc": "ITA"}, ... ],
                "officials": [...],
                "source": { "pdf": "2024-25シーズン/Ruka/Ruka_男子モーグル決勝2_8105.pdf", "pdf_sha256": "...", "fis_url": null,
                            "report_created": "SAT 30 NOV 2024 17:18", "imported_at": "...", "parser_version": "...", "rules_version": "2024-25" },
                "verification": { "layer0": "ok", "layer1": "ok", "layer2": "ok", "layer3": "ok", "layer4": "ok", "layer5": "ok|skipped" } } ] }
```

### runs.<season>.<hash>.json — 1ラン1レコード
```
{ "run_id": "2025-26-8105-F2-2484937",        // season-codex-round-fiscode（Q2 ファイルの Q1 参照ブロックは "-Q1ref" を付ける）
  "round_id": "2025-26-8105-F2", "event_id": "...", "season": "2025-26", "series": "WC", "gender": "M", "round": "F2",
  "rank": 1, "bib": 2, "fis_code": "2484937", "athlete_id": "2484937", "name": "KINGSBURY Mikael", "noc": "CAN", "yb": 1992,
  "status": "OK" | "DNF" | "DNS" | "DSQ", "reserve_judge": false,
  "seconds": 20.51, "time_points": 15.79,
  "air": [ {"J6": 8.6, "J7": 8.8, "jump": "bdF", "dd": 1.05, "v6": 9.03, "v7": 9.24, "jump_score": 9.135}, {...} ],
  "air_total": 17.11,
  "base": [17.8, 18.0, 17.4, 18.4, 17.5], "base_discard": [2, 3], "base_total": 53.3,   // discard = 除外された index（最高・最低）
  "ded":  [-0.7, -0.6, -1.0, -1.4, -0.5], "ded_discard": [3, 4], "ded_total": -2.3,
  "turns_total": 51.0, "turns_floor_applied": false, "run_score": 83.90, "tie": null,
  "q_block": null | "Q2" | "Q1ref",  "counting": true,   // Q2 ファイル: 採用されたブロックか
  "components": null,                                     // 将来: [{"judge_no":1,"carving":..,"absorption":..,"upper_body":..}, ...]
  "provenance": {"pdf": "...", "page": 1, "parser_version": "...", "rules_version": "2024-25"} }
```

### athletes.<hash>.json
```
{ "athlete_id": "2484937", "fis_code": "2484937", "name": "KINGSBURY Mikael", "aliases": ["キングスベリー"],
  "noc": "CAN", "noc_history": [{"noc": "CAN", "from": "2022-23", "to": "2025-26"}], "yb": 1992,
  "n_runs": 40, "best": {"run_score": 91.83, "run_id": "..."}, "seasons": ["2022-23", ...] }
```
別名は `etl/athlete_aliases.json`（FIS コード → 別名配列）を人が保守。

### lines.<hash>.json — ラウンドごとの基準線
```
{ "round_id": "...", "winner": {run要約}, "cut": {"rank": 16, "run": {run要約}, "label": "決勝1進出ライン"} | null,
  "n_advance": 16 }
```

### judges.<hash>.json — 審判マスタ（画面には出さない）
`judge_id`, `name`, `noc`, `aliases`, `rounds`（担当ラウンド ID と番号）。表記ゆれは `etl/judge_overrides.json`。

### rules/<version>.json — 規則版（大会日・大会種別・フォーマットで選択）
判定ジャッジ数、除外数、切り捨て桁、エア上限、ターン下限、ペース速度、タイム点式、通過人数、DD 表の版、タイブレーク順。
2022-23 / 2023-24 / 2024-25 / 2025-26 を用意（内容は同じでも版として分ける）。26/27 は改定後に追加。

## 3. ETL（`etl/`）

`python -m etl.build` の1コマンド。標準ライブラリ ＋ pdfplumber。手順:

1. **取り込み対象の列挙**: PDF フォルダを走査し、ファイル名から season/venue/gender/round/codex を得る。デュアルは除外。
2. **読み取り A**（`parsers/parser_a.py`、座標ベース、既存 `_tools/parse_pdf.py` を拡張）と
   **読み取り B**（`parsers/parser_b.py`、`extract_text()` の行を正規表現で読む別実装）。
   両方が Q1/Q2 二段レイアウトを扱う。
3. **多層照合**（`verify/` 配下、結果は `docs/検証レポート.md` に全件出力）
   - 第0層 完全性: 大会 × ラウンドの期待一覧（`etl/expected_rounds.json`、人が accept）との一致。
     PDF の Number of Competitors ＝ 抽出人数。run_id の重複なし。
   - 第1層 二重読み取り: A と B の全項目一致。
   - 第2層 再計算: Decimal で FIS 規則から Time Points / Air Total / Base・Ded Total / Turns Total / Run Score を計算し印字と一致。
     ジャンプコード → DD が同一シーズン内で一貫していること（規則版の DD 表があればそれとも一致）。
   - 第3層 再構成: Run Score とタイブレーク（Turns → Air without DD → Time）から順位を作り印字順位と一致。
     フォーマット別に F1 出場者 ＝ Q の通過者、F2 ＝ F1 の通過者、Q2 の採用点 ＝ Q1/Q2 の高い方、を検算（同点は全員通過）。
   - 第4層 横断整合: FIS コード → 生年は厳格、氏名・国は別名／履歴として扱い変化は警告。
     同一大会ラウンド間の審判名・ペースタイム差異は警告。
   - 第5層 外部照合: FIS サイトの結果（`etl/fis_fetch.py`）とラン得点・順位を突き合わせ。到達不可なら `skipped` と明記。
   - 正解データ回帰: `golden/*.json`（PDF を画像で目視して作った正解）と A・B の出力を照合。
   - 変異テスト: `etl/tests/test_mutations.py`。正しいデータをわざと壊し、どの層が止めるかを確認。
4. **公開ゲート**: 1ラウンドでも赤があればそのラウンドを含む大会は出力しない（全か無か）。
   公開済みラウンドの JSON ハッシュと元 PDF の SHA-256 を `etl/published_hashes.json` に記録し、
   黙って変わったらエラー。PDF 側の変化は「公式ソース改訂」として `--accept-revision` で通す。
5. **出力**: `data/` に内容ハッシュ付きで書き出し、`manifest.json` を更新。検証レポート・受け入れ基準の結果を表示。

## 4. 自動更新（段階1）

`.github/workflows/update.yml`: シーズン中は毎日、FIS のイベント一覧から新しい単走リザルト PDF を探して取得し、
ETL と多層照合を回す。全部緑なら Pull Request を作って通知、赤なら Issue を作る。公開（マージ）は人が行う。
段階2（全自動公開）は1シーズン運用後に設定で切替。FIS への到達性はこの PC からは確認済み（data.fis-ski.com 200）。
Actions からの到達性は初回実行で確認する。

## 5. 受け入れ基準（Phase 1 完了の条件）

1. 対象 192 ファイル（単走 185 ＋ Q1/Q2 形式 7）すべてが第0〜4層で緑。第5層は結果を明記。
2. 正解データ（20本以上、レイアウト・状況を網羅）と A・B の出力が一致。
3. 変異テスト 10 種すべてで、少なくとも1つの層が誤りを止める。
4. 3画面が PC 幅と 390px 幅で横スクロールなしに表示され、JS エラーなし。
5. 選手ページの「上のラインとの差」が、手計算した1例と一致する。
6. `README.md` に大会追加の手順（trampo-results と同じ書式）がある。
7. push 前に Van さんが内容を確認する。
