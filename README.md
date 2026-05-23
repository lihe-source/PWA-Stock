# 台股雷達 Stock Radar V1_2

這是一個可部署到 GitHub Pages 的台股 / ETF 篩選 PWA。

## 功能

- 支援上市股票、上櫃股票、上市 ETF、上櫃 ETF。
- 使用免費公開資料來源：TWSE OpenAPI、TPEx OpenAPI。
- 使用 GitHub Actions 在週一至週五 17:17 抓資料，17:47 補跑一次。
- 手機端 PWA 只讀取整理後的 `screening.json`，不直接大量請求交易所伺服器。
- 技術面篩選：RS、22 日高點距離、短期均線、中長期均線、扣抵值。
- 基本面與籌碼面 UI 已保留，初版停用，避免使用假資料。
- 扁平化資料架構：主要檔案都在專案根目錄。

## 重要說明

GitHub Actions 的 workflow 檔案必須放在 `.github/workflows/fetch-stock.yml`，這是 GitHub 的必要規則，無法完全扁平化。本專案也提供一份 `github-workflow-fetch-stock.yml` 在根目錄，方便手機查看與複製。

## 部署步驟

1. 建立 GitHub Repository。
2. 上傳整個 `StockRadar_V1_2` 內的檔案到 repository 根目錄。
3. 確認 `.github/workflows/fetch-stock.yml` 有成功上傳。
4. 到 GitHub：`Settings → Pages`。
5. Source 選擇 `Deploy from a branch`。
6. Branch 選 `main`，資料夾選 `/root`。
7. 到 `Settings → Actions → General`，確認 Workflow permissions 設為 `Read and write permissions`。
8. 到 `Actions → Fetch Taiwan Stock Radar Data → Run workflow` 手動執行一次。
9. 等 workflow 成功後，`screening.json` 會被更新，PWA 就會顯示資料。

## 每日更新時間

- 主要執行：週一至週五 17:17，Asia/Taipei。
- 補跑執行：週一至週五 17:47，Asia/Taipei。

此設計的目標是在晚上 6 點以前完成當天資料整理。但 GitHub Actions 仍可能因平台排程延遲，無法保證秒級準時。

## 檔案說明

| 檔案 | 用途 |
|---|---|
| `index.html` | PWA 入口 |
| `styles.css` | 手機優先 UI 樣式 |
| `app.js` | 前端篩選、結果、自選股、主題、版本檢查 |
| `service-worker.js` | PWA 快取；資料 JSON 採 network-first |
| `manifest.json` | PWA manifest |
| `icon.svg` | App icon |
| `version.json` | 版本檢查檔 |
| `update-config.js` | 前端版本檢查設定 |
| `fetch-stock.mjs` | GitHub Actions 用的資料抓取與整理程式 |
| `screening.json` | 前端主要讀取的篩選資料 |
| `latest.json` | 當日基本行情資料 |
| `history-prices.json` | 最近 150 個交易日價格，用於技術指標 |
| `meta.json` | 資料更新與來源狀態 |
| `.github/workflows/fetch-stock.yml` | 自動排程抓資料 |
| `github-workflow-fetch-stock.yml` | workflow 根目錄備份，方便手機查看 |

## 資料與 API 上限設計

本專案避免「每檔股票打一個 API」的做法，改用全市場批次 endpoint，降低被限制或逾時的風險。

保護機制：

- timeout：每個請求 20 秒。
- retry：最多 5 次。
- 429 backoff：遇到 Too Many Requests 會延遲後再試。
- workflow concurrency：避免重複流程互相覆蓋。
- 資料先抓完再寫檔；若失敗，不覆蓋舊資料。
- 僅保留最近 150 個交易日，避免 repository 過大。

## 本版限制

- 初次部署後，技術面需要逐日累積資料。MA120 需要約 120 個交易日後才完整。
- 基本面與籌碼面篩選 UI 已設計，但 V1_2 尚未接月營收、財報、法人與集保資料，因此先停用。
- 此工具僅供研究與紀錄，不構成投資建議。
