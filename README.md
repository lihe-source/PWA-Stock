# 台股雷達 Stock Radar V1_3

手機優先的台股 / ETF 篩選 PWA，部署在 GitHub Pages，使用 GitHub Actions 在收盤後整理免費公開資料。

## V1_3 更新重點

1. 重新設計 UI，提高淺色與深色模式可讀性。
2. 結果頁改成條列式比較清單，方便比較價格、漲跌、成交量、營收 YoY、外資、投信等欄位。
3. 基本面篩選已可勾選：月營收創高或同期高、YoY 連 2 月、MoM 連 2 月、毛利率 / 營益率改善、公司沒有虧損。
4. 籌碼面篩選已可勾選：籌碼集中度增加、外資買超、投信買超、大戶持股比例增加、法人持股創一季新高。
5. `近期買賣家數差 < 0` 仍保留但停用，因免費且穩定的分點買賣家數資料來源不適合批次抓全市場。
6. 新增 `history-revenue.json`、`history-financials.json`、`history-chip.json`，讓基本面與籌碼面可逐步累積。

## 檔案結構

根目錄保持扁平，方便手機上傳 GitHub。唯一必要子資料夾是 GitHub Actions 規定的 `.github/workflows/`。

```text
StockRadar_V1_3/
├── index.html
├── styles.css
├── app.js
├── service-worker.js
├── manifest.json
├── icon.svg
├── version.json
├── update-config.js
├── fetch-stock.mjs
├── package.json
├── screening.json
├── latest.json
├── history-prices.json
├── history-revenue.json
├── history-financials.json
├── history-chip.json
├── meta.json
├── github-workflow-fetch-stock.yml
└── .github/workflows/fetch-stock.yml
```

## GitHub Pages 部署

1. 將 ZIP 解壓縮後，把 `StockRadar_V1_3` 內的所有檔案上傳到 GitHub repo 根目錄。
2. 確認 repo 有 `.github/workflows/fetch-stock.yml`。
3. 到 `Settings → Pages`，選 `Deploy from a branch`。
4. Branch 選 `main`，資料夾選 `/root`。
5. 到 `Settings → Actions → General → Workflow permissions`，設定 `Read and write permissions`。
6. 到 `Actions → Fetch Taiwan Stock Radar Data → Run workflow` 手動執行一次。

## 排程

Workflow 使用 UTC cron，對應台灣時間如下：

- `17 9 * * 1-5` = 台灣時間週一至週五 17:17
- `47 9 * * 1-5` = 台灣時間週一至週五 17:47 補跑

## 注意事項

- 技術面條件需要累積歷史收盤價，首次部署後會逐日變完整。
- 月營收連 2 月條件至少需要累積兩個月份資料。
- 季財報條件需要公開資料來源成功回傳且欄位可解析。
- ETF 沒有公司月營收與季財報，因此基本面條件通常不會符合。
- 抓資料策略採用批次 endpoint，不逐檔股票請求，降低台股數千檔資料造成流量限制的風險。

## 本地語法檢查

```bash
npm run check
```

## 手動抓資料

```bash
npm run fetch
```
