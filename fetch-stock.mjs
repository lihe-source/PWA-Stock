import fs from "node:fs/promises";

const APP_VERSION = "V1_3";
const TIMEZONE = "Asia/Taipei";
const MAX_TRADING_DAYS = 150;
const FETCH_TIMEOUT_MS = 20000;
const MAX_RETRIES = 4;

const FILES = {
  screening: "screening.json",
  latest: "latest.json",
  historyPrices: "history-prices.json",
  historyRevenue: "history-revenue.json",
  historyFinancials: "history-financials.json",
  historyChip: "history-chip.json",
  meta: "meta.json"
};

const SOURCES = {
  twseDaily: ["https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"],
  tpexDaily: [
    "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
    "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes"
  ],
  revenueTwse: ["https://openapi.twse.com.tw/v1/opendata/t187ap05_L"],
  revenueTpex: ["https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O"],
  financialTwse: ["https://openapi.twse.com.tw/v1/opendata/t187ap15_L"],
  financialTpex: ["https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap15_O"]
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function taiwanDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function taiwanDateString(date = new Date()) {
  const map = taiwanDateParts(date);
  return `${map.year}-${map.month}-${map.day}`;
}

function yyyymmdd(date = new Date()) {
  const map = taiwanDateParts(date);
  return `${map.year}${map.month}${map.day}`;
}

function dateMinusDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() - days);
  return next;
}

async function fetchTextWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json,text/plain,*/*",
          "User-Agent": "StockRadarPWA/1.3 (+https://github.com/)"
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (response.status === 429) {
        const retryMs = 30000 + Math.random() * 15000;
        console.warn(`429 Too Many Requests. Wait ${Math.round(retryMs)}ms. URL: ${url}`);
        await sleep(retryMs);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt === MAX_RETRIES) break;
      const waitMs = 1800 * attempt + Math.random() * 2200;
      console.warn(`Fetch failed (${attempt}/${MAX_RETRIES}) ${url}: ${error.message}. Retry in ${Math.round(waitMs)}ms.`);
      await sleep(waitMs);
    }
  }
  throw lastError || new Error(`Fetch failed: ${url}`);
}

async function fetchJsonWithRetry(url) {
  const text = await fetchTextWithRetry(url);
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

async function fetchFirstAvailable(urls, label, required = true) {
  const errors = [];
  for (const url of urls) {
    try {
      const rows = await fetchJsonWithRetry(url);
      if (!Array.isArray(rows)) throw new Error("Response is not an array");
      console.log(`${label}: ${rows.length} rows from ${url}`);
      return { rows, url, ok: true, error: null };
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
      console.warn(`${label} source failed: ${url} ${error.message}`);
    }
  }
  if (required) throw new Error(`${label} all sources failed. ${errors.join(" | ")}`);
  return { rows: [], url: null, ok: false, error: errors.join(" | ") };
}

async function readJsonOrDefault(filename, fallback) {
  try {
    const text = await fs.readFile(filename, "utf8");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeJson(filename, data, pretty = true) {
  await fs.writeFile(filename, JSON.stringify(data, null, pretty ? 2 : 0), "utf8");
}

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function cleanNumber(value) {
  if (value === undefined || value === null) return null;
  let text = String(value)
    .replace(/,/g, "")
    .replace(/X/g, "")
    .replace(/\+/g, "")
    .replace(/−/g, "-")
    .replace(/\(([-\d.]+)\)/g, "-$1")
    .trim();
  if (!text || text === "--" || text === "---" || text === "NaN") return null;
  const match = text.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

function getField(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== "") return row[name];
  }
  return null;
}

function getFieldByIncludes(row, patterns) {
  const keys = Object.keys(row || {});
  for (const pattern of patterns) {
    const key = keys.find((item) => item.includes(pattern));
    if (key && row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return null;
}

function normalizeCode(value) {
  return cleanText(value).replace(/[^0-9A-Z]/gi, "").toUpperCase();
}

function detectSecurityType(code, name) {
  const n = cleanText(name).toUpperCase();
  if (n.includes("ETN") || n.includes("指數投資證券")) return "OTHER";
  if (/^00\d{2,4}[A-Z]?$/.test(code) || n.includes("ETF")) return "ETF";
  if (/^\d{4}$/.test(code) && !code.startsWith("00")) return "STOCK";
  return "OTHER";
}

function shouldKeepSecurity(item) {
  if (!item.code || !item.name) return false;
  if (item.securityType !== "STOCK" && item.securityType !== "ETF") return false;
  const name = item.name.toUpperCase();
  const excludedWords = ["權證", "牛證", "熊證", "ETN", "指數投資證券", "存託憑證", "受益證券"];
  return !excludedWords.some((word) => name.includes(word));
}

function normalizeTwse(row) {
  const code = normalizeCode(getField(row, ["Code", "證券代號", "code", "stockNo"]));
  const name = cleanText(getField(row, ["Name", "證券名稱", "name", "stockName"]));
  const item = {
    market: "TWSE",
    marketName: "上市",
    code,
    name,
    open: cleanNumber(getField(row, ["OpeningPrice", "開盤價", "open"])),
    high: cleanNumber(getField(row, ["HighestPrice", "最高價", "high"])),
    low: cleanNumber(getField(row, ["LowestPrice", "最低價", "low"])),
    close: cleanNumber(getField(row, ["ClosingPrice", "收盤價", "close"])),
    change: cleanNumber(getField(row, ["Change", "漲跌價差", "change"])),
    volume: cleanNumber(getField(row, ["TradeVolume", "成交股數", "volume"])),
    amount: cleanNumber(getField(row, ["TradeValue", "成交金額", "amount"])),
    transactions: cleanNumber(getField(row, ["Transaction", "成交筆數", "transactions"]))
  };
  item.securityType = detectSecurityType(item.code, item.name);
  return item;
}

function normalizeTpex(row) {
  const code = normalizeCode(getField(row, ["SecuritiesCompanyCode", "Code", "代號", "有價證券代號", "code"]));
  const name = cleanText(getField(row, ["CompanyName", "Name", "名稱", "有價證券名稱", "name"]));
  const item = {
    market: "TPEX",
    marketName: "上櫃",
    code,
    name,
    open: cleanNumber(getField(row, ["Open", "開盤", "開盤價", "open"])),
    high: cleanNumber(getField(row, ["High", "最高", "最高價", "high"])),
    low: cleanNumber(getField(row, ["Low", "最低", "最低價", "low"])),
    close: cleanNumber(getField(row, ["Close", "收盤", "收盤價", "close"])),
    change: cleanNumber(getField(row, ["Change", "漲跌", "漲跌價差", "change"])),
    volume: cleanNumber(getField(row, ["Volume", "成交股數", "成交張數", "volume"])),
    amount: cleanNumber(getField(row, ["Amount", "成交金額", "amount"])),
    transactions: cleanNumber(getField(row, ["Transactions", "成交筆數", "transactions"]))
  };
  item.securityType = detectSecurityType(item.code, item.name);
  return item;
}

function enrichDailyItem(item) {
  const close = item.close;
  const change = item.change;
  const prevClose = close !== null && change !== null ? close - change : null;
  const changePercent = prevClose && prevClose !== 0 ? (change / prevClose) * 100 : null;
  return { ...item, changePercent: changePercent === null ? null : Number(changePercent.toFixed(2)) };
}

function toHistoryRow(item, date) {
  return [date, item.close, item.high, item.low, item.volume, item.amount];
}

function updatePriceHistory(history, items, date, nowIso) {
  const next = {
    schema: "stock-radar-history-prices-v1",
    appVersion: APP_VERSION,
    updatedAt: nowIso,
    timezone: TIMEZONE,
    maxTradingDays: MAX_TRADING_DAYS,
    entries: history?.entries && typeof history.entries === "object" ? history.entries : {}
  };
  for (const item of items) {
    if (item.close === null) continue;
    const id = `${item.market}:${item.code}`;
    const entry = next.entries[id] || { c: item.code, n: item.name, m: item.market, mt: item.marketName, t: item.securityType, p: [] };
    entry.c = item.code;
    entry.n = item.name;
    entry.m = item.market;
    entry.mt = item.marketName;
    entry.t = item.securityType;
    entry.p = Array.isArray(entry.p) ? entry.p : [];
    const row = toHistoryRow(item, date);
    const existingIndex = entry.p.findIndex((priceRow) => priceRow[0] === date);
    if (existingIndex >= 0) entry.p[existingIndex] = row;
    else entry.p.push(row);
    entry.p.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    if (entry.p.length > MAX_TRADING_DAYS) entry.p = entry.p.slice(-MAX_TRADING_DAYS);
    next.entries[id] = entry;
  }
  return next;
}

function priceRowsFor(history, item) {
  const rows = history.entries?.[`${item.market}:${item.code}`]?.p;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => Array.isArray(row) && row.length >= 2 && Number.isFinite(Number(row[1]))).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function avg(values) {
  const nums = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!nums.length || nums.length !== values.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function calcBaseIndicators(item, rows) {
  const closes = rows.map((row) => row[1]);
  const highs = rows.map((row) => row[2] ?? row[1]);
  const volumes = rows.map((row) => row[4]);
  const n = closes.length;
  const close = item.close;
  const ma5 = n >= 5 ? avg(closes.slice(-5)) : null;
  const ma10 = n >= 10 ? avg(closes.slice(-10)) : null;
  const ma20 = n >= 20 ? avg(closes.slice(-20)) : null;
  const ma60 = n >= 60 ? avg(closes.slice(-60)) : null;
  const ma120 = n >= 120 ? avg(closes.slice(-120)) : null;
  const vol5 = n >= 5 ? avg(volumes.slice(-5)) : null;
  const vol20 = n >= 20 ? avg(volumes.slice(-20)) : null;
  const high22 = n >= 22 ? Math.max(...highs.slice(-22).filter((value) => Number.isFinite(Number(value))).map(Number)) : null;
  const close20Ago = n >= 21 ? Number(closes[n - 21]) : null;
  const close60Ago = n >= 61 ? Number(closes[n - 61]) : null;
  const return20 = n >= 21 && Number(closes[n - 21]) > 0 ? ((close - Number(closes[n - 21])) / Number(closes[n - 21])) * 100 : null;
  const prevClose = n >= 2 ? Number(closes[n - 2]) : null;
  return {
    ma5, ma10, ma20, ma60, ma120, vol5, vol20, high22, close20Ago, close60Ago, return20, prevClose,
    nearHigh22: high22 !== null && close !== null ? close >= high22 * 0.95 : false,
    maShortBull: ma5 !== null && ma10 !== null && ma20 !== null ? ma5 > ma10 && ma10 > ma20 : false,
    maMidBull: ma20 !== null && ma60 !== null && ma120 !== null ? ma20 > ma60 && ma60 > ma120 : false,
    aboveDeduction: close20Ago !== null && close60Ago !== null && close !== null ? close > close20Ago && close > close60Ago : false,
    volumeExpansion: vol20 !== null && item.volume !== null ? item.volume > vol20 * 1.5 : false,
    volumeTrendUp: vol5 !== null && vol20 !== null ? vol5 > vol20 * 1.15 : false,
    historyDays: n
  };
}

function normalizeRevenue(row, market) {
  const code = normalizeCode(getField(row, ["公司代號", "公司代碼", "出表公司代號", "CompanyCode", "SecuritiesCompanyCode", "Code"]));
  const name = cleanText(getField(row, ["公司名稱", "CompanyName", "Name", "名稱"]));
  const periodRaw = cleanText(getField(row, ["資料年月", "年月", "YearMonth", "DataYearMonth"]));
  const period = normalizePeriod(periodRaw);
  return {
    market,
    code,
    name,
    period,
    revenue: cleanNumber(getField(row, ["營業收入-當月營收", "當月營收", "MonthlyRevenue", "Revenue"])),
    lastMonthRevenue: cleanNumber(getField(row, ["營業收入-上月營收", "上月營收", "LastMonthRevenue"])),
    lastYearRevenue: cleanNumber(getField(row, ["營業收入-去年當月營收", "去年當月營收", "LastYearMonthRevenue"])),
    mom: cleanNumber(getField(row, ["營業收入-上月比較增減(%)", "上月比較增減(%)", "MoM"])),
    yoy: cleanNumber(getField(row, ["營業收入-去年同月增減(%)", "去年同月增減(%)", "YoY"])),
    cumulativeRevenue: cleanNumber(getField(row, ["累計營業收入-當月累計營收", "當月累計營收", "CumulativeRevenue"])),
    cumulativeYoy: cleanNumber(getField(row, ["累計營業收入-前期比較增減(%)", "前期比較增減(%)", "CumulativeYoY"]))
  };
}

function normalizePeriod(value) {
  const text = cleanText(value);
  if (!text) return "";
  const nums = text.match(/\d+/g);
  if (!nums || nums.length === 0) return text;
  if (nums.length >= 2) {
    let y = Number(nums[0]);
    const m = String(nums[1]).padStart(2, "0");
    if (y < 1911) y += 1911;
    return `${y}-${m}`;
  }
  if (nums[0].length >= 5) {
    let y = Number(nums[0].slice(0, nums[0].length - 2));
    const m = nums[0].slice(-2).padStart(2, "0");
    if (y < 1911) y += 1911;
    return `${y}-${m}`;
  }
  return text;
}

function updateRevenueHistory(history, records, nowIso) {
  const next = {
    schema: "stock-radar-history-revenue-v1",
    appVersion: APP_VERSION,
    updatedAt: nowIso,
    timezone: TIMEZONE,
    entries: history?.entries && typeof history.entries === "object" ? history.entries : {}
  };
  for (const record of records) {
    if (!record.code || !record.period || record.revenue === null) continue;
    const id = `${record.market}:${record.code}`;
    const entry = next.entries[id] || { c: record.code, n: record.name, m: record.market, r: [] };
    entry.c = record.code;
    entry.n = record.name;
    entry.m = record.market;
    entry.r = Array.isArray(entry.r) ? entry.r : [];
    const row = [record.period, record.revenue, record.lastMonthRevenue, record.lastYearRevenue, record.mom, record.yoy, record.cumulativeRevenue, record.cumulativeYoy];
    const idx = entry.r.findIndex((item) => item[0] === record.period);
    if (idx >= 0) entry.r[idx] = row;
    else entry.r.push(row);
    entry.r.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    if (entry.r.length > 36) entry.r = entry.r.slice(-36);
    next.entries[id] = entry;
  }
  return next;
}

function revenueRowsFor(history, item) {
  const rows = history.entries?.[`${item.market}:${item.code}`]?.r;
  return Array.isArray(rows) ? rows.slice().sort((a, b) => String(a[0]).localeCompare(String(b[0]))) : [];
}

function normalizeFinancial(row, market) {
  const code = normalizeCode(getField(row, ["公司代號", "公司代碼", "出表公司代號", "CompanyCode", "SecuritiesCompanyCode", "Code"]));
  const name = cleanText(getField(row, ["公司名稱", "CompanyName", "Name", "名稱"]));
  const year = cleanText(getField(row, ["年度", "年", "Year"]));
  const quarter = cleanText(getField(row, ["季別", "季度", "Quarter"]));
  const period = normalizeFinancialPeriod(year, quarter, row);
  const revenue = cleanNumber(getFieldByIncludes(row, ["營業收入", "收益"]));
  const grossProfit = cleanNumber(getFieldByIncludes(row, ["營業毛利", "毛利"]));
  const operatingIncome = cleanNumber(getFieldByIncludes(row, ["營業利益", "營業淨利"]));
  const netIncome = cleanNumber(getFieldByIncludes(row, ["本期淨利", "稅後淨利", "綜合損益總額", "淨利"]));
  const eps = cleanNumber(getFieldByIncludes(row, ["基本每股盈餘", "每股盈餘", "EPS"]));
  return {
    market,
    code,
    name,
    period,
    revenue,
    grossProfit,
    operatingIncome,
    netIncome,
    eps,
    grossMargin: revenue && grossProfit !== null ? (grossProfit / revenue) * 100 : null,
    operatingMargin: revenue && operatingIncome !== null ? (operatingIncome / revenue) * 100 : null
  };
}

function normalizeFinancialPeriod(year, quarter, row) {
  let y = cleanNumber(year);
  let q = cleanNumber(quarter);
  if (y !== null && y < 1911) y += 1911;
  if (y !== null && q !== null) return `${y}-Q${q}`;
  const text = Object.values(row || {}).map((value) => cleanText(value)).join(" ");
  const match = text.match(/(\d{2,4}).*?第?([1-4])季/);
  if (match) {
    y = Number(match[1]);
    if (y < 1911) y += 1911;
    return `${y}-Q${match[2]}`;
  }
  return "";
}

function updateFinancialHistory(history, records, nowIso) {
  const next = {
    schema: "stock-radar-history-financials-v1",
    appVersion: APP_VERSION,
    updatedAt: nowIso,
    timezone: TIMEZONE,
    entries: history?.entries && typeof history.entries === "object" ? history.entries : {}
  };
  for (const record of records) {
    if (!record.code || !record.period) continue;
    const id = `${record.market}:${record.code}`;
    const entry = next.entries[id] || { c: record.code, n: record.name, m: record.market, f: [] };
    entry.c = record.code;
    entry.n = record.name;
    entry.m = record.market;
    entry.f = Array.isArray(entry.f) ? entry.f : [];
    const row = [record.period, record.revenue, record.grossProfit, record.operatingIncome, record.netIncome, record.grossMargin, record.operatingMargin, record.eps];
    const idx = entry.f.findIndex((item) => item[0] === record.period);
    if (idx >= 0) entry.f[idx] = row;
    else entry.f.push(row);
    entry.f.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    if (entry.f.length > 16) entry.f = entry.f.slice(-16);
    next.entries[id] = entry;
  }
  return next;
}

function financialRowsFor(history, item) {
  const rows = history.entries?.[`${item.market}:${item.code}`]?.f;
  return Array.isArray(rows) ? rows.slice().sort((a, b) => String(a[0]).localeCompare(String(b[0]))) : [];
}

function buildTwseT86Urls(now) {
  const urls = [];
  for (let i = 0; i < 8; i += 1) {
    const date = yyyymmdd(dateMinusDays(now, i));
    urls.push(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`);
  }
  urls.push("https://www.twse.com.tw/rwd/zh/fund/T86?date=&selectType=ALLBUT0999&response=json");
  return urls;
}

async function fetchTwseInstitution(now) {
  const urls = buildTwseT86Urls(now);
  const errors = [];
  for (const url of urls) {
    try {
      const json = await fetchJsonWithRetry(url);
      const rows = normalizeTwseInstitution(json);
      if (rows.length) return { rows, url, ok: true, error: null };
      errors.push(`${url}: empty rows`);
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
      console.warn(`TWSE institution failed: ${url} ${error.message}`);
    }
  }
  return { rows: [], url: null, ok: false, error: errors.join(" | ") };
}

function normalizeTwseInstitution(json) {
  if (!json) return [];
  const fields = json.fields || json.stat || [];
  const data = Array.isArray(json.data) ? json.data : [];
  if (!Array.isArray(fields) || !Array.isArray(data)) return [];
  const fieldIndex = (patterns) => fields.findIndex((field) => patterns.some((pattern) => String(field).includes(pattern)));
  const idxCode = fieldIndex(["證券代號"]);
  const idxName = fieldIndex(["證券名稱"]);
  const idxForeign = fieldIndex(["外陸資買賣超股數", "外資買賣超股數"]);
  const idxTrust = fieldIndex(["投信買賣超股數"]);
  const idxDealer = fieldIndex(["自營商買賣超股數"]);
  const idxTotal = fieldIndex(["三大法人買賣超股數"]);
  return data.map((row) => {
    const array = Array.isArray(row) ? row : [];
    return {
      market: "TWSE",
      code: normalizeCode(array[idxCode]),
      name: cleanText(array[idxName]),
      foreignNet: idxForeign >= 0 ? cleanNumber(array[idxForeign]) : null,
      trustNet: idxTrust >= 0 ? cleanNumber(array[idxTrust]) : null,
      dealerNet: idxDealer >= 0 ? cleanNumber(array[idxDealer]) : null,
      totalNet: idxTotal >= 0 ? cleanNumber(array[idxTotal]) : null
    };
  }).filter((item) => item.code);
}

function updateChipHistory(history, chipRecords, date, nowIso) {
  const next = {
    schema: "stock-radar-history-chip-v1",
    appVersion: APP_VERSION,
    updatedAt: nowIso,
    timezone: TIMEZONE,
    entries: history?.entries && typeof history.entries === "object" ? history.entries : {}
  };
  for (const record of chipRecords) {
    if (!record.code) continue;
    const id = `${record.market}:${record.code}`;
    const entry = next.entries[id] || { c: record.code, n: record.name, m: record.market, x: [] };
    entry.c = record.code;
    entry.n = record.name;
    entry.m = record.market;
    entry.x = Array.isArray(entry.x) ? entry.x : [];
    const row = [date, record.foreignNet, record.trustNet, record.dealerNet, record.totalNet];
    const idx = entry.x.findIndex((item) => item[0] === date);
    if (idx >= 0) entry.x[idx] = row;
    else entry.x.push(row);
    entry.x.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    if (entry.x.length > 70) entry.x = entry.x.slice(-70);
    next.entries[id] = entry;
  }
  return next;
}

function chipRowsFor(history, item) {
  const rows = history.entries?.[`${item.market}:${item.code}`]?.x;
  return Array.isArray(rows) ? rows.slice().sort((a, b) => String(a[0]).localeCompare(String(b[0]))) : [];
}

function calcFundamental(item, revenueRows, financialRows) {
  if (item.securityType === "ETF") {
    return {
      flags: { revenueHigh: false, revenueYoY2M: false, revenueMoM2M: false, marginGrowth: false, profitable: false },
      metrics: { revenuePeriod: null, revenueYoY: null, revenueMoM: null, netIncome: null, eps: null, grossMargin: null, operatingMargin: null }
    };
  }

  const latestRevenue = revenueRows.at(-1);
  const revenueValues = revenueRows.map((row) => row[1]).filter((value) => Number.isFinite(Number(value))).map(Number);
  const latestRevenueAmount = latestRevenue ? latestRevenue[1] : null;
  const latestMom = latestRevenue ? latestRevenue[4] : null;
  const latestYoy = latestRevenue ? latestRevenue[5] : null;
  const lastTwoRevenue = revenueRows.slice(-2);

  const revenueHigh = latestRevenueAmount !== null && latestRevenueAmount !== undefined
    ? revenueValues.length <= 1
      ? Number(latestYoy) > 0
      : Number(latestRevenueAmount) >= Math.max(...revenueValues.slice(0, -1)) || Number(latestYoy) > 0
    : false;
  const revenueYoY2M = lastTwoRevenue.length >= 2 && lastTwoRevenue.every((row) => Number(row[5]) > 20);
  const revenueMoM2M = lastTwoRevenue.length >= 2 && lastTwoRevenue.every((row) => Number(row[4]) > 20);

  const latestFinancial = financialRows.at(-1);
  const compareFinancial = findComparableQuarter(financialRows, latestFinancial);
  const grossMargin = latestFinancial ? latestFinancial[5] : null;
  const operatingMargin = latestFinancial ? latestFinancial[6] : null;
  const netIncome = latestFinancial ? latestFinancial[4] : null;
  const eps = latestFinancial ? latestFinancial[7] : null;
  const marginGrowth = latestFinancial && compareFinancial
    ? (Number(grossMargin) > Number(compareFinancial[5]) || Number(operatingMargin) > Number(compareFinancial[6]))
    : false;
  const profitable = Number(netIncome) > 0 || Number(eps) > 0;

  return {
    flags: { revenueHigh, revenueYoY2M, revenueMoM2M, marginGrowth, profitable },
    metrics: {
      revenuePeriod: latestRevenue ? latestRevenue[0] : null,
      revenue: latestRevenueAmount ?? null,
      revenueYoY: latestYoy ?? null,
      revenueMoM: latestMom ?? null,
      netIncome: netIncome ?? null,
      eps: eps ?? null,
      grossMargin: grossMargin === null || grossMargin === undefined ? null : Number(Number(grossMargin).toFixed(2)),
      operatingMargin: operatingMargin === null || operatingMargin === undefined ? null : Number(Number(operatingMargin).toFixed(2))
    }
  };
}

function findComparableQuarter(rows, latest) {
  if (!latest || !latest[0]) return null;
  const match = String(latest[0]).match(/(\d{4})-Q([1-4])/);
  if (!match) return rows.length >= 2 ? rows.at(-2) : null;
  const prevYearPeriod = `${Number(match[1]) - 1}-Q${match[2]}`;
  return rows.find((row) => row[0] === prevYearPeriod) || (rows.length >= 2 ? rows.at(-2) : null);
}

function calcChip(item, indicators, chipRows) {
  const latestChip = chipRows.at(-1);
  const recent13 = chipRows.slice(-13);
  const totalNetValues = recent13.map((row) => row[4]).filter((value) => Number.isFinite(Number(value))).map(Number);
  const totalNet = latestChip ? latestChip[4] : null;
  const foreignNet = latestChip ? latestChip[1] : null;
  const trustNet = latestChip ? latestChip[2] : null;
  const dealerNet = latestChip ? latestChip[3] : null;

  const majorHolderIncrease = indicators.volumeExpansion && item.close !== null && (indicators.prevClose === null || item.close >= indicators.prevClose);
  const largeHolderRatioUp = indicators.volumeTrendUp && Number(indicators.return20) >= 0;
  const institutionalQuarterHigh = totalNetValues.length >= 3 && Number(totalNet) > 0 && Number(totalNet) >= Math.max(...totalNetValues);

  return {
    flags: {
      majorHolderIncrease,
      brokerDiffNegative: false,
      foreignBuy: Number(foreignNet) > 0,
      trustBuy: Number(trustNet) > 0,
      largeHolderRatioUp,
      institutionalQuarterHigh
    },
    metrics: {
      chipDate: latestChip ? latestChip[0] : null,
      foreignNet: foreignNet ?? null,
      trustNet: trustNet ?? null,
      dealerNet: dealerNet ?? null,
      totalNet: totalNet ?? null,
      volumeMA5: indicators.vol5 === null ? null : Math.round(indicators.vol5),
      volumeMA20: indicators.vol20 === null ? null : Math.round(indicators.vol20)
    }
  };
}

function assignRs(items) {
  const withReturn = items
    .filter((item) => Number.isFinite(Number(item.indicators.return20)))
    .sort((a, b) => Number(a.indicators.return20) - Number(b.indicators.return20));
  const count = withReturn.length;
  if (!count) return;
  withReturn.forEach((item, index) => {
    const rs = count === 1 ? 100 : Math.round((index / (count - 1)) * 100);
    item.indicators.rs = rs;
    item.technical.rsAbove90 = rs >= 90;
  });
}

function buildScreeningItems(items, priceHistory, revenueHistory, financialHistory, chipHistory) {
  const screeningItems = items.map((item) => {
    const rows = priceRowsFor(priceHistory, item);
    const indicators = calcBaseIndicators(item, rows);
    const fundamental = calcFundamental(item, revenueRowsFor(revenueHistory, item), financialRowsFor(financialHistory, item));
    const chip = calcChip(item, indicators, chipRowsFor(chipHistory, item));
    const technical = {
      rsAbove90: false,
      nearHigh22: indicators.nearHigh22,
      maShortBull: indicators.maShortBull,
      maMidBull: indicators.maMidBull,
      aboveDeduction: indicators.aboveDeduction
    };
    return {
      market: item.market,
      marketName: item.marketName,
      securityType: item.securityType,
      code: item.code,
      name: item.name,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      change: item.change,
      changePercent: item.changePercent,
      volume: item.volume,
      amount: item.amount,
      transactions: item.transactions,
      technical,
      fundamental: fundamental.flags,
      chip: chip.flags,
      indicators: {
        rs: null,
        return20: indicators.return20 === null ? null : Number(indicators.return20.toFixed(2)),
        ma5: indicators.ma5 === null ? null : Number(indicators.ma5.toFixed(2)),
        ma10: indicators.ma10 === null ? null : Number(indicators.ma10.toFixed(2)),
        ma20: indicators.ma20 === null ? null : Number(indicators.ma20.toFixed(2)),
        ma60: indicators.ma60 === null ? null : Number(indicators.ma60.toFixed(2)),
        ma120: indicators.ma120 === null ? null : Number(indicators.ma120.toFixed(2)),
        high22: indicators.high22,
        historyDays: indicators.historyDays
      },
      fundamentalMetrics: fundamental.metrics,
      chipMetrics: chip.metrics,
      score: 0
    };
  });
  assignRs(screeningItems);
  for (const item of screeningItems) {
    item.score = [...Object.values(item.technical), ...Object.values(item.fundamental), ...Object.values(item.chip)].filter(Boolean).length;
  }
  return screeningItems.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.code).localeCompare(String(b.code), "zh-Hant");
  });
}

function countBy(items, key, value) {
  return items.filter((item) => item[key] === value).length;
}

async function main() {
  const now = new Date();
  const nowIso = now.toISOString();
  const dataDate = taiwanDateString(now);

  const [twseResult, tpexResult, revenueTwseResult, revenueTpexResult, financialTwseResult, financialTpexResult, chipTwseResult] = await Promise.all([
    fetchFirstAvailable(SOURCES.twseDaily, "TWSE daily", true),
    fetchFirstAvailable(SOURCES.tpexDaily, "TPEX daily", true),
    fetchFirstAvailable(SOURCES.revenueTwse, "TWSE revenue", false),
    fetchFirstAvailable(SOURCES.revenueTpex, "TPEX revenue", false),
    fetchFirstAvailable(SOURCES.financialTwse, "TWSE financial", false),
    fetchFirstAvailable(SOURCES.financialTpex, "TPEX financial", false),
    fetchTwseInstitution(now)
  ]);

  const twseItems = twseResult.rows.map(normalizeTwse);
  const tpexItems = tpexResult.rows.map(normalizeTpex);
  const items = [...twseItems, ...tpexItems]
    .map(enrichDailyItem)
    .filter(shouldKeepSecurity)
    .filter((item) => item.close !== null)
    .sort((a, b) => `${a.market}:${a.code}`.localeCompare(`${b.market}:${b.code}`, "zh-Hant"));

  if (!items.length) throw new Error("No stock or ETF rows were kept. Please inspect source format changes.");

  const revenueRecords = [
    ...revenueTwseResult.rows.map((row) => normalizeRevenue(row, "TWSE")),
    ...revenueTpexResult.rows.map((row) => normalizeRevenue(row, "TPEX"))
  ];
  const financialRecords = [
    ...financialTwseResult.rows.map((row) => normalizeFinancial(row, "TWSE")),
    ...financialTpexResult.rows.map((row) => normalizeFinancial(row, "TPEX"))
  ];
  const chipRecords = chipTwseResult.rows;

  const previousPriceHistory = await readJsonOrDefault(FILES.historyPrices, { schema: "stock-radar-history-prices-v1", entries: {} });
  const previousRevenueHistory = await readJsonOrDefault(FILES.historyRevenue, { schema: "stock-radar-history-revenue-v1", entries: {} });
  const previousFinancialHistory = await readJsonOrDefault(FILES.historyFinancials, { schema: "stock-radar-history-financials-v1", entries: {} });
  const previousChipHistory = await readJsonOrDefault(FILES.historyChip, { schema: "stock-radar-history-chip-v1", entries: {} });

  const priceHistory = updatePriceHistory(previousPriceHistory, items, dataDate, nowIso);
  const revenueHistory = updateRevenueHistory(previousRevenueHistory, revenueRecords, nowIso);
  const financialHistory = updateFinancialHistory(previousFinancialHistory, financialRecords, nowIso);
  const chipHistory = updateChipHistory(previousChipHistory, chipRecords, dataDate, nowIso);

  const screeningItems = buildScreeningItems(items, priceHistory, revenueHistory, financialHistory, chipHistory);
  const counts = {
    TWSE: countBy(screeningItems, "market", "TWSE"),
    TPEX: countBy(screeningItems, "market", "TPEX"),
    STOCK: countBy(screeningItems, "securityType", "STOCK"),
    ETF: countBy(screeningItems, "securityType", "ETF")
  };

  const sourceStatus = {
    daily: { TWSE: twseResult.ok, TPEX: tpexResult.ok },
    revenue: { TWSE: revenueTwseResult.ok, TPEX: revenueTpexResult.ok },
    financial: { TWSE: financialTwseResult.ok, TPEX: financialTpexResult.ok },
    chip: { TWSE: chipTwseResult.ok, TPEX: false }
  };

  const common = {
    appVersion: APP_VERSION,
    status: "ok",
    updatedAt: nowIso,
    dataDate,
    timezone: TIMEZONE,
    totalCount: screeningItems.length,
    counts,
    sourceStatus,
    source: {
      TWSE_DAILY: twseResult.url,
      TPEX_DAILY: tpexResult.url,
      TWSE_REVENUE: revenueTwseResult.url,
      TPEX_REVENUE: revenueTpexResult.url,
      TWSE_FINANCIAL: financialTwseResult.url,
      TPEX_FINANCIAL: financialTpexResult.url,
      TWSE_CHIP: chipTwseResult.url
    }
  };

  const latest = {
    schema: "stock-radar-latest-v1",
    ...common,
    items: items.map((item) => ({
      market: item.market,
      marketName: item.marketName,
      securityType: item.securityType,
      code: item.code,
      name: item.name,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      change: item.change,
      changePercent: item.changePercent,
      volume: item.volume,
      amount: item.amount,
      transactions: item.transactions
    }))
  };

  const screening = {
    schema: "stock-radar-screening-v1",
    ...common,
    support: {
      technical: "enabled; improves as price history accumulates",
      fundamental: "enabled for stocks when monthly revenue / financial datasets are available; ETFs generally have no company fundamentals",
      chip: "enabled for TWSE institution data and volume-based chip proxies; unsupported data remains false instead of blocking workflow"
    },
    items: screeningItems
  };

  const meta = {
    schema: "stock-radar-meta-v1",
    ...common,
    schedule: {
      primary: "17:17 Asia/Taipei on weekdays",
      retry: "17:47 Asia/Taipei on weekdays",
      note: "The retry run helps finish daily data preparation before 18:00 when the platform is not delayed."
    },
    limits: {
      strategy: "batch endpoints only; no per-symbol requests",
      maxTradingDaysKept: MAX_TRADING_DAYS,
      historyFiles: [FILES.historyPrices, FILES.historyRevenue, FILES.historyFinancials, FILES.historyChip]
    }
  };

  await writeJson(FILES.historyPrices, priceHistory, false);
  await writeJson(FILES.historyRevenue, revenueHistory, false);
  await writeJson(FILES.historyFinancials, financialHistory, false);
  await writeJson(FILES.historyChip, chipHistory, false);
  await writeJson(FILES.latest, latest, true);
  await writeJson(FILES.screening, screening, true);
  await writeJson(FILES.meta, meta, true);

  console.log(`Data date: ${dataDate}`);
  console.log(`Total: ${screeningItems.length}`);
  console.log(`TWSE: ${counts.TWSE}, TPEX: ${counts.TPEX}, STOCK: ${counts.STOCK}, ETF: ${counts.ETF}`);
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
