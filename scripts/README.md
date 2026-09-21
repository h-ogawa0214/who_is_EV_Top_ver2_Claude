# データ半自動更新パイプライン（自販連版）

`ev-registrations.json` を「自動で下書き → 人がPRで承認」で更新する。
`docs/index.html`（表示ロジックのビルド成果物）には一切触れない。JSONだけを更新する。

```
scripts/
  jada-config.ts        … 自販連サイト固有の設定（URL発見・ラベル対応表）。※要・実物確認
  lib/
    types.ts            … スキーマ型・FetchResult
    http.ts             … レート制限つき取得＋.cache/保存＋UA(連絡先)
    xlsx-table.ts       … xlsx→行列・ヘッダー駆動のセル探索
  fetch/
    jada-monthly.ts     … 月報（燃料別メーカー別・乗用車EV）
    jada-annual.ts      … 年別統計（確定値）
  update-data.ts        … 取得結果を JSON にマージ（years は months から再計算）
  validate.ts           … 不変条件＋異常値検知
  sync-docs.ts          … docs/ev-registrations.json へ同期／一致検査
  inspect.ts            … 実物xlsxのシートをダンプ（初回確認・障害調査用）
  test/run.ts           … オフライン受け入れテスト
```

## コマンド

```bash
cd scripts && npm install         # 依存はここだけ。docs/ には混入しない
npm test                          # オフラインテスト（14 checks）

# リポジトリ直下から実行（データJSONは直下にある想定）
./scripts/node_modules/.bin/tsx scripts/update-data.ts                 # 月報の最新月
./scripts/node_modules/.bin/tsx scripts/update-data.ts --month=9       # 指定月
./scripts/node_modules/.bin/tsx scripts/update-data.ts --annual=2025   # 年次確定値で上書き
./scripts/node_modules/.bin/tsx scripts/update-data.ts --input=r.json --dry-run  # 取得せず適用（テスト）
./scripts/node_modules/.bin/tsx scripts/validate.ts ev-registrations.json
./scripts/node_modules/.bin/tsx scripts/sync-docs.ts                   # docs/ へコピー
./scripts/node_modules/.bin/tsx scripts/inspect.ts --page              # 実物xlsxを確認
```

CIは `.github/workflows/update-data.yml`（毎月8日・12日＋手動）と
`.github/workflows/validate-data.yml`（PRのたびに検査）の2本。

## 取得元と確認結果

- 取得元: 自販連「燃料別登録台数」 https://www.jada.or.jp/pages/342/
- **公表形式**: PDF と Excel(xlsx) の両方。**xlsx を主軸**にパースする（PDFより壊れにくい）。
  月報 xlsx と 年別統計 xlsx が別々に置かれる。
- **ファイルURL**: `/files/libs/<id>/<timestamp>.xlsx` 形式で毎回変わるため、URLは固定せず
  ページHTMLのリンク文言（例「燃料別登録台数統計（2026年1月～8月）」「年別統計（2021年～2025年）」）
  から発見する（`jada-config.ts` の `findMonthlyXlsx` / `findAnnualXlsx`）。
- **対象**: 乗用車の EV(BEV) 列のみ。PHV・HV・FCV・ガソリン等は除外（`isEvHeader`）。
  「輸入車」は合計1行（ブランド別内訳は非公表）。スズキ・ダイハツ等は0扱い。
- **robots / 規約（確認日 2026-09-21）**: 統計ページの `meta robots` は `index,follow`。
  自販連は当該統計の公式な公表団体であり、PDF/xlsx は誰でもダウンロードできる形で公開されている。
  > ⚠️ この環境から `robots.txt` 本体と利用規約ページを直接取得できなかったため、
  > **本番で有効化する前に `https://www.jada.or.jp/robots.txt` と利用規約を最終確認**し、
  > 問題なければこの節に「確認済み」と追記すること。取得間隔は1秒以上、UAに連絡先
  > （`JADA_CONTACT` 変数）を入れている。

## ⚠️ 初回に1度だけ必要な実物確認

`jada-config.ts` のEV列判定・メーカー行ラベル・月/年ヘッダーの走査は、列位置をハードコード
せずヘッダー駆動にしてあるが、**実ファイルのシート内レイアウトまでは検証できていない**
（配布時点でバイナリを開けなかったため）。初回に次を実行して確認する。

```bash
./scripts/node_modules/.bin/tsx scripts/inspect.ts --page
```

シート名・EVらしき列・各メーカー行・先頭数行がダンプされる。ここで
`extractMonthly` / `extractAnnual` が正しい値を拾えていなければ、`jada-config.ts` の
`MAKER_LABELS` や EV 判定、月/年の走査方法だけを調整する（他ファイルは触らない）。
`update-data.ts --dry-run` で JSON 差分を目視確認してから本番投入すること。

## マージの考え方（重要）

- **months が唯一の入力**。`years[Y]` は `months[Y]` の合計から**再計算**する
  → 不変条件4（月次合計＝年値）が構造的に必ず成立する。
- 12か月そろうと `partial` から当該年が消え、サイトの「1〜N月」表記と `*` 付き年ボタンが消える。
- 年次統計は確定値。月次合計と食い違う場合（遡及修正）は**年次を正**とし、差分をPR本文に警告表示。
- `meta.sourceDetail` は収録範囲から自動生成。`display` / `makers` / `trendMax` は自動更新しない
  （見せ方の設計判断のため）。`trendMax` が不変条件6に反したらエラーで停止するので、人が引き上げる。

## 取得が壊れたときの復旧手順

1. まず `inspect.ts --page` で公表書式が変わっていないか確認する。
2. 変わっていれば `jada-config.ts` のラベル/走査を直す（ここだけで直るはず）。
3. 急ぎで数字を出したいときは **JSONを手で直す**:
   - `ev-registrations.json` の `months.<年>` に当月行を追記（キーは makers と同じ7つ＋`m`、値は台・整数）
   - `years.<年>` は編集不要（`update-data` が再計算する）が、手編集した場合は月次合計と一致させる
   - `partial.<年>` の `throughMonth` と `label`（"1〜N月"）を更新
   - `./scripts/node_modules/.bin/tsx scripts/validate.ts ev-registrations.json` で検査
   - `./scripts/node_modules/.bin/tsx scripts/sync-docs.ts` で docs/ に反映
   - コミットしてPR → マージで公開サイトに反映（HTMLの再ビルドは不要）

## `docs/index.html` を再生成する必要があるケース

**表示ロジック（見た目・章構成・グラフの描き方）を変えたときだけ**。
その場合は `EV Makers Infographic.dc.html` を編集して `docs/index.html` を作り直す。
**データだけの更新では再生成不要**（HTMLは実行時に `./ev-registrations.json` を読むため）。
