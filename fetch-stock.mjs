import fs from "node:fs/promises";

const APP_VERSION = "V1_2";
const TIMEZONE = "Asia/Taipei";
const MAX_TRADING_DAYS = 150;
const FETCH_TIMEOUT_MS = 20000;
const MAX_RETRIES = 5;

const FILES = {
  screening: "screening.json",
  latest: "latest.json",
  history: "history-prices.json",
  meta: "meta.json"
};

const SOURCES = {
  twse: [
    "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
  ],
  tpex: [
    "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
    "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes"
  ]
};

function taiwanDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json,text/plain,*/*",
          "User-Agent": "StockRadarPWA/1.2 (+https://github.com/)"
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

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const text = await response.text();
      return JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch (error) {
      clearTimeout(timer);
      lastError = error;

      if (attempt === MAX_RETRIES) break;

      const waitMs = 1600 * attempt + Math.random() * 2000;
      console.warn(`Fetch failed (${attempt}/${MAX_RETRIES}) ${url}: ${error.message}. Retry in ${Math.round(waitMs)}ms.`);
      await sleep(waitMs);
    }
  }

  throw lastError || new Error(`Fetch failed: ${url}`);
}

async function fetchFirstAvailable(urls, label) {
  const errors = [];

  for (const url of urls) {
    try {
      const rows = await fetchJsonWithRetry(url);
      if (!Array.isArray(rows)) {
        throw new Error("Response is not an array");
      }
      console.log(`${label}: ${rows.length} rows from ${url}`);
      return { rows, url };
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
      console.warn(`${label} source failed: ${url} ${error.message}`);
    }
  }

  throw new Error(`${label} all sources failed. ${errors.join(" | ")}`);
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
    .trim();

  if (!text || text === "--" || text === "---" || text === "除權息" || text === "NaN") return null;

  // Some exchange fields may contain display notes after the number.
  const match = text.match(/-?\d+(\.\d+)?/);
  if (!match) return null;

  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

function getField(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== "") {
      return row[name];
    }
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
  const code = normalizeCode(getField(row, [
    "SecuritiesCompanyCode",
    "Code",
    "代號",
    "有價證券代號",
    "code"
  ]));
  const name = cleanText(getField(row, [
    "CompanyName",
    "Name",
    "名稱",
    "有價證券名稱",
    "name"
  ]));

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

  return {
    ...item,
    changePercent: changePercent === null ? null : Number(changePercent.toFixed(2))
  };
}

async function readJsonOrDefault(filename, fallback) {
  try {
    const text = await fs.readFile(filename, "utf8");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function toHistoryRow(item, date) {
  return [
    date,
    item.close,
    item.high,
    item.low,
    item.volume,
    item.amount
  ];
}

function updateHistory(history, items, date, nowIso) {
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
    const entry = next.entries[id] || {
      c: item.code,
      n: item.name,
      m: item.market,
      mt: item.marketName,
      t: item.securityType,
      p: []
    };

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
  const id = `${item.market}:${item.code}`;
  const rows = history.entries?.[id]?.p;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => Array.isArray(row) && row.length >= 2 && Number.isFinite(Number(row[1])))
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function avg(values) {
  const nums = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!nums.length || nums.length !== values.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function calcBaseIndicators(item, rows) {
  const closes = rows.map((row) => row[1]);
  const highs = rows.map((row) => row[2] ?? row[1]);
  const n = closes.length;
  const close = item.close;

  const ma5 = n >= 5 ? avg(closes.slice(-5)) : null;
  const ma10 = n >= 10 ? avg(closes.slice(-10)) : null;
  const ma20 = n >= 20 ? avg(closes.slice(-20)) : null;
  const ma60 = n >= 60 ? avg(closes.slice(-60)) : null;
  const ma120 = n >= 120 ? avg(closes.slice(-120)) : null;
  const high22 = n >= 22 ? Math.max(...highs.slice(-22).filter((value) => Number.isFinite(Number(value))).map(Number)) : null;
  const close20Ago = n >= 21 ? Number(closes[n - 21]) : null;
  const close60Ago = n >= 61 ? Number(closes[n - 61]) : null;
  const return20 = n >= 21 && Number(closes[n - 21]) > 0 ? ((close - Number(closes[n - 21])) / Number(closes[n - 21])) * 100 : null;

  return {
    ma5,
    ma10,
    ma20,
    ma60,
    ma120,
    high22,
    close20Ago,
    close60Ago,
    return20,
    nearHigh22: high22 !== null && close !== null ? close >= high22 * 0.95 : false,
    maShortBull: ma5 !== null && ma10 !== null && ma20 !== null ? ma5 > ma10 && ma10 > ma20 : false,
    maMidBull: ma20 !== null && ma60 !== null && ma120 !== null ? ma20 > ma60 && ma60 > ma120 : false,
    aboveDeduction: close20Ago !== null && close60Ago !== null && close !== null ? close > close20Ago && close > close60Ago : false,
    historyDays: n
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

function buildScreeningItems(items, history) {
  const screeningItems = items.map((item) => {
    const rows = priceRowsFor(history, item);
    const indicators = calcBaseIndicators(item, rows);

    const technical = {
      rsAbove90: false,
      nearHigh22: indicators.nearHigh22,
      maShortBull: indicators.maShortBull,
      maMidBull: indicators.maMidBull,
      aboveDeduction: indicators.aboveDeduction
    };

    const fundamental = {
      revenueHigh: false,
      revenueYoY2M: false,
      revenueMoM2M: false,
      marginGrowth: false,
      profitable: false
    };

    const chip = {
      majorHolderIncrease: false,
      brokerDiffNegative: false,
      foreignBuy: false,
      trustBuy: false,
      largeHolderRatioUp: false,
      institutionalQuarterHigh: false
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
      fundamental,
      chip,
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
      score: 0
    };
  });

  assignRs(screeningItems);

  for (const item of screeningItems) {
    item.score = [
      ...Object.values(item.technical),
      ...Object.values(item.fundamental),
      ...Object.values(item.chip)
    ].filter(Boolean).length;
  }

  return screeningItems.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.code).localeCompare(String(b.code), "zh-Hant");
  });
}

function countBy(items, key, value) {
  return items.filter((item) => item[key] === value).length;
}

async function writeJson(filename, data, pretty = true) {
  await fs.writeFile(filename, JSON.stringify(data, null, pretty ? 2 : 0), "utf8");
}

async function main() {
  const now = new Date();
  const nowIso = now.toISOString();
  const dataDate = taiwanDateString(now);

  const [twseResult, tpexResult] = await Promise.all([
    fetchFirstAvailable(SOURCES.twse, "TWSE"),
    fetchFirstAvailable(SOURCES.tpex, "TPEX")
  ]);

  const twseItems = twseResult.rows.map(normalizeTwse);
  const tpexItems = tpexResult.rows.map(normalizeTpex);

  const items = [...twseItems, ...tpexItems]
    .map(enrichDailyItem)
    .filter(shouldKeepSecurity)
    .filter((item) => item.close !== null)
    .sort((a, b) => `${a.market}:${a.code}`.localeCompare(`${b.market}:${b.code}`, "zh-Hant"));

  if (!items.length) {
    throw new Error("No stock or ETF rows were kept. Please inspect source format changes.");
  }

  const previousHistory = await readJsonOrDefault(FILES.history, {
    schema: "stock-radar-history-prices-v1",
    appVersion: APP_VERSION,
    updatedAt: null,
    timezone: TIMEZONE,
    maxTradingDays: MAX_TRADING_DAYS,
    entries: {}
  });

  const history = updateHistory(previousHistory, items, dataDate, nowIso);
  const screeningItems = buildScreeningItems(items, history);

  const counts = {
    TWSE: countBy(screeningItems, "market", "TWSE"),
    TPEX: countBy(screeningItems, "market", "TPEX"),
    STOCK: countBy(screeningItems, "securityType", "STOCK"),
    ETF: countBy(screeningItems, "securityType", "ETF")
  };

  const common = {
    appVersion: APP_VERSION,
    status: "ok",
    updatedAt: nowIso,
    dataDate,
    timezone: TIMEZONE,
    totalCount: screeningItems.length,
    counts,
    source: {
      TWSE: twseResult.url,
      TPEX: tpexResult.url
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
      technical: "enabled after enough collected trading days",
      fundamental: "reserved; disabled in UI until monthly revenue / quarterly financial data is connected",
      chip: "reserved; disabled in UI until institutional / TDCC data is connected"
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
      historyFile: FILES.history
    }
  };

  await writeJson(FILES.history, history, false);
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
