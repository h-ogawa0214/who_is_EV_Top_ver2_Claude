# who_is_EV_Top — 日本のEV（BEV）登録台数 インフォグラフィック

自販連「燃料別登録台数統計」をもとに、日本の登録乗用車BEVを2021年〜2026年8月まで
メーカー別に可視化する静的サイト＋その半自動更新パイプライン。

```
ev-registrations.json      … データの唯一の情報源（canonical）
docs/                      … GitHub Pages で公開するディレクトリ
  index.html               … 表示（依存ゼロ・ビルド不要の単一HTML）
  ev-registrations.json    … 配信用コピー（sync-docs が生成）
scripts/                   … 半自動更新パイプライン（→ scripts/README.md）
.github/workflows/
  update-data.yml          … 毎月8日・12日＋手動。取得→PR作成
  validate-data.yml        … PRのたびに不変条件を検査
```

- サイトは外部ライブラリなし・ビルド不要。`docs/index.html` は実行時に
  `./ev-registrations.json` を読み込む。**数値の更新はJSONを差し替えるだけ**。
- データとプレゼンテーションは分離済み。パイプラインが触るのはJSONだけで、
  `docs/index.html`（表示ロジックのビルド成果物）には触れない。

## 公開手順（GitHub Pages）

1. 一式をリポジトリにプッシュ
2. GitHub → **Settings → Pages**
3. **Source: Deploy from a branch** / **Branch: `main`（または既存の運用ブランチ）** / **Folder: `/docs`** を選んで **Save**
4. 数分後 `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開

> ローカル確認は `cd docs && python3 -m http.server 8000` → http://localhost:8000/
> （`file://` 直接ではJSONを読めない。読めない環境向けに `index.html` に埋め込み
> フォールバックを内蔵しているが、正の情報源は `ev-registrations.json`）

## データの更新

### 自動（推奨）

`scripts/` のパイプラインが月報を取得し、下書きをPRとして提出する。人がPRを承認すると
公開サイトの数値が変わる（HTMLの再ビルドは不要）。手動実行は Actions → *Update EV data (JADA)*
→ *Run workflow*。詳細と初回セットアップは **[scripts/README.md](scripts/README.md)**。

### 手動

`ev-registrations.json` を編集 →
`./scripts/node_modules/.bin/tsx scripts/validate.ts ev-registrations.json` で検査 →
`./scripts/node_modules/.bin/tsx scripts/sync-docs.ts` で `docs/` に反映 → PR。

## スキーマの要点（不変条件は `scripts/validate.ts` が機械検査）

- `years[Y]` のキー＝`makers` のキー。値は**台・整数**。
- `months[Y]` の各メーカー合計＝`years[Y]` の同値（部分年）。`years` は月次から再計算される。
- `partial[Y].throughMonth`＝`months[Y]` の月数。12か月そろうと `partial` から消える。
- `meta.trendMax` は年合計の最大より大きいこと。`share` は表示時に合計100へ自動調整。

出典: 一般社団法人日本自動車販売協会連合会「燃料別登録台数」 https://www.jada.or.jp/pages/342/

- 登録車（乗用車）のみ。軽自動車は含まない。日本メーカーの海外生産車は輸入車に計上。
- 輸入車はブランド別内訳が非公表のため合計値。2026年は月報1〜8月の累計で通年値ではない。
