# StockRadar_V1_4 台股雷達

台股雷達是部署在 GitHub Pages 的 PWA，使用 GitHub Actions 在收盤後離峰時段整理免費公開資料，前端只讀取已整理好的 JSON，降低手機端與交易所資料源的負擔。

## V1_4 更新重點

- 修正篩選頁面無法滑到最下方按按鈕的問題：改成固定在底部導覽上方的「套用篩選」按鈕，且主內容區保留足夠底部間距。
- UI 全面重製：由大卡片式改為資料密度較高、適合大量股票比較的清單式 UI。
- 結果頁改為條列式比較：每列顯示價格、漲跌、RS、成交量、成交額、營收 YoY、外資、投信。
- 頁面最上方顯示資料更新時間，格式為 `yyyy/mm/dd hh:mm`。
- 新增自動檢查程式更新：開啟 App、回到前景、每 15 分鐘自動檢查 `version.json` 與 Service Worker 更新。
- 保留上市股票、上櫃股票、上市 ETF、上櫃 ETF 篩選。
- 檔案維持扁平化，方便手機上傳 GitHub。

## 部署方式

1. 將 `StockRadar_V1_4` 資料夾內所有檔案上傳到 GitHub repository 根目錄。
2. 確認 `.github/workflows/fetch-stock.yml` 存在。
3. 到 `Settings → Pages`，選擇 `Deploy from a branch`，branch 選 `main`，folder 選 `/root`。
4. 到 `Settings → Actions → General → Workflow permissions`，選 `Read and write permissions`。
5. 到 `Actions → Fetch Taiwan Stock Radar Data → Run workflow` 手動執行一次。
6. 成功後會更新：
   - `screening.json`
   - `latest.json`
   - `history-prices.json`
   - `history-revenue.json`
   - `history-financials.json`
   - `history-chip.json`
   - `meta.json`

## 排程

GitHub Actions 使用 UTC 時間，對應台灣時間如下：

- `17 9 * * 1-5` = 台灣時間 17:17
- `47 9 * * 1-5` = 台灣時間 17:47 補跑

目標是在晚上 6 點前完成當天股票狀態整理。

## 檔案說明

- `index.html`：PWA 主畫面。
- `styles.css`：新 UI 樣式。
- `app.js`：前端狀態管理、篩選、清單渲染、自動更新檢查。
- `service-worker.js`：PWA 快取與新版切換。
- `fetch-stock.mjs`：GitHub Actions 抓取並整理資料。
- `version.json`：App 版本檢查檔。
- `update-config.js`：前端自動檢查更新設定。
- `.github/workflows/fetch-stock.yml`：GitHub Actions 排程。
- `github-workflow-fetch-stock.yml`：手機操作備份檔，不會被 GitHub 自動執行。

## 注意事項

- PWA 前端不直接大量請求交易所 API，避免數千檔股票造成流量壓力。
- ETF 沒有公司營收與財報，因此基本面條件通常不會符合。
- 「近期買賣家數差 < 0」需要穩定分點資料，免費全市場來源不足，暫不納入篩選。
- 初次部署後若資料仍是空的，請先手動執行一次 GitHub Actions。
