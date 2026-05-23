const APP_VERSION = "V1_4";
const DATA_URL = "./screening.json";
const WATCH_KEY = "stock-radar-watchlist-v1";
const THEME_KEY = "stock-radar-theme";
const PAGE_SIZE = 120;

const FILTER_GROUPS = [
  {
    id: "technical",
    title: "技術面",
    note: "價格、強度、均線與扣抵",
    filters: [
      { id: "rsAbove90", title: "RS 指標大於 90", subtitle: "近 20 日相對強度排名前 10%" },
      { id: "nearHigh22", title: "距 22 日高點 ≤ 5%", subtitle: "收盤價接近近月高點" },
      { id: "maShortBull", title: "短期均線多頭排列", subtitle: "MA5 > MA10 > MA20" },
      { id: "maMidBull", title: "中長期均線多頭排列", subtitle: "MA20 > MA60 > MA120" },
      { id: "aboveDeduction", title: "站上扣抵值", subtitle: "收盤 > 20 / 60 日前股價" }
    ]
  },
  {
    id: "fundamental",
    title: "基本面",
    note: "月營收、財報與獲利狀態",
    filters: [
      { id: "revenueHigh", title: "營收創高或同期高", subtitle: "月營收創已收錄高點或年增為正" },
      { id: "revenueYoY2M", title: "年增率連 2 月 > 20%", subtitle: "近 2 個月營收 YoY" },
      { id: "revenueMoM2M", title: "月增率連 2 月 > 20%", subtitle: "近 2 個月營收 MoM" },
      { id: "marginGrowth", title: "毛利率 / 營益率改善", subtitle: "季財報較可比資料提升" },
      { id: "profitable", title: "公司沒有虧損", subtitle: "最新季淨利或 EPS > 0" }
    ]
  },
  {
    id: "chip",
    title: "籌碼面",
    note: "法人、集中度與量能結構",
    filters: [
      { id: "majorHolderIncrease", title: "籌碼集中度增加", subtitle: "以量價與歷史成交量估算" },
      { id: "brokerDiffNegative", title: "近期買賣家數差 < 0", subtitle: "免費來源不穩，暫不納入篩選", disabled: true },
      { id: "foreignBuy", title: "外資買超", subtitle: "三大法人資料可用時判斷" },
      { id: "trustBuy", title: "投信買超", subtitle: "三大法人資料可用時判斷" },
      { id: "largeHolderRatioUp", title: "大戶持股比例增加", subtitle: "以量能趨勢替代估算" },
      { id: "institutionalQuarterHigh", title: "法人持股創一季新高", subtitle: "近 13 筆法人淨買超高點" }
    ]
  }
];

const state = {
  raw: null,
  items: [],
  filtered: [],
  visibleCount: PAGE_SIZE,
  selected: new Set(),
  watch: new Set(),
  activeView: "filter",
  serviceWorkerWaiting: null,
  reloadingForUpdate: false
};

const els = {
  app: document.querySelector("#app"),
  dataUpdatedAt: document.querySelector("#dataUpdatedAt"),
  appUpdatedAt: document.querySelector("#appUpdatedAt"),
  settingsDataTime: document.querySelector("#settingsDataTime"),
  marketSummary: document.querySelector("#marketSummary"),
  totalCountText: document.querySelector("#totalCountText"),
  selectedCountText: document.querySelector("#selectedCountText"),
  previewCountText: document.querySelector("#previewCountText"),
  filterGroups: document.querySelector("#filterGroups"),
  runFilterBtn: document.querySelector("#runFilterBtn"),
  manualRefreshBtn: document.querySelector("#manualRefreshBtn"),
  manualUpdateBtn: document.querySelector("#manualUpdateBtn"),
  checkUpdateBtn: document.querySelector("#checkUpdateBtn"),
  clearFilterBtn: document.querySelector("#clearFilterBtn"),
  clearFilterInlineBtn: document.querySelector("#clearFilterInlineBtn"),
  modeSelect: document.querySelector("#modeSelect"),
  marketSelect: document.querySelector("#marketSelect"),
  typeSelect: document.querySelector("#typeSelect"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  resultHeading: document.querySelector("#resultHeading"),
  resultSubtitle: document.querySelector("#resultSubtitle"),
  activeChips: document.querySelector("#activeChips"),
  resultsList: document.querySelector("#resultsList"),
  loadMoreBtn: document.querySelector("#loadMoreBtn"),
  watchList: document.querySelector("#watchList"),
  themeToggle: document.querySelector("#themeToggle"),
  toast: document.querySelector("#toast"),
  mainScroll: document.querySelector("#mainScroll"),
  updateBanner: document.querySelector("#updateBanner"),
  updateTitle: document.querySelector("#updateTitle"),
  updateMessage: document.querySelector("#updateMessage"),
  reloadAppBtn: document.querySelector("#reloadAppBtn")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString("zh-TW", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function formatCompact(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const num = Number(value);
  if (Math.abs(num) >= 100000000) return `${formatNumber(num / 100000000, 1)}億`;
  if (Math.abs(num) >= 10000) return `${formatNumber(num / 10000, 1)}萬`;
  return formatNumber(num);
}

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const num = Number(value);
  const digits = num >= 100 ? 1 : 2;
  return num.toLocaleString("zh-TW", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(2)}%`;
}

function formatDateTime(value) {
  if (!value) return "尚未更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未更新";
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}/${map.month}/${map.day} ${map.hour}:${map.minute}`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function showUpdateBanner(title, message) {
  els.updateTitle.textContent = title;
  els.updateMessage.textContent = message;
  els.updateBanner.hidden = false;
}

function hideUpdateBanner() {
  els.updateBanner.hidden = true;
}

function loadWatchlist() {
  try {
    const list = JSON.parse(localStorage.getItem(WATCH_KEY) || "[]");
    state.watch = new Set(Array.isArray(list) ? list : []);
  } catch {
    state.watch = new Set();
  }
}

function saveWatchlist() {
  localStorage.setItem(WATCH_KEY, JSON.stringify([...state.watch]));
}

function applyTheme(theme) {
  const resolved = theme === "dark" ? "dark" : "light";
  document.documentElement.classList.toggle("dark", resolved === "dark");
  els.themeToggle.textContent = resolved === "dark" ? "☀" : "◐";
  localStorage.setItem(THEME_KEY, resolved);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) {
    applyTheme(saved);
    return;
  }
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "dark" : "light");
}

function getAllFilters() {
  return FILTER_GROUPS.flatMap((group) => group.filters.map((filter) => ({ ...filter, groupId: group.id, groupTitle: group.title })));
}

function getFilterInfo(filterId) {
  return getAllFilters().find((item) => item.id === filterId);
}

function renderFilterGroups() {
  els.filterGroups.innerHTML = FILTER_GROUPS.map((group) => {
    const enabled = group.filters.filter((filter) => !filter.disabled);
    const selectedCount = enabled.filter((filter) => state.selected.has(filter.id)).length;
    const allSelected = enabled.length > 0 && enabled.every((filter) => state.selected.has(filter.id));
    const rows = group.filters.map((filter) => {
      const checked = state.selected.has(filter.id) ? "checked" : "";
      const disabled = filter.disabled ? "disabled" : "";
      const disabledClass = filter.disabled ? " disabled" : "";
      return `
        <label class="condition-item${disabledClass}">
          <input type="checkbox" data-filter-id="${escapeHtml(filter.id)}" ${checked} ${disabled} />
          <span class="check-ui" aria-hidden="true"></span>
          <span class="condition-copy">
            <strong>${escapeHtml(filter.title)}</strong>
            <small>${escapeHtml(filter.subtitle)}</small>
          </span>
        </label>
      `;
    }).join("");

    return `
      <article class="condition-group" data-group-id="${escapeHtml(group.id)}">
        <div class="condition-head">
          <div class="condition-title">
            <h3>${escapeHtml(group.title)}</h3>
            <p>${escapeHtml(group.note)}</p>
          </div>
          <div class="condition-count">${selectedCount}/${enabled.length}</div>
          <button class="condition-toggle" type="button" data-group-toggle="${escapeHtml(group.id)}">${allSelected ? "取消" : "全選"}</button>
        </div>
        <div class="condition-list">${rows}</div>
      </article>
    `;
  }).join("");
  updateSelectedCounter();
}

function getSelectedFilters() {
  return [...state.selected];
}

function updateSelectedCounter() {
  const selected = getSelectedFilters();
  els.selectedCountText.textContent = String(selected.length);
}

function matchesSelectedFilters(item, selectedFilters, mode) {
  if (selectedFilters.length === 0) return true;
  const matched = selectedFilters.filter((filterId) => Boolean(item.technical?.[filterId] || item.fundamental?.[filterId] || item.chip?.[filterId])).length;
  item._matchedCount = matched;
  if (mode === "AND") return matched === selectedFilters.length;
  if (mode === "OR") return matched > 0;
  if (mode === "SCORE") return matched > 0;
  return true;
}

function applyFilters() {
  const query = els.searchInput.value.trim().toLowerCase();
  const mode = els.modeSelect.value;
  const market = els.marketSelect.value;
  const type = els.typeSelect.value;
  const selectedFilters = getSelectedFilters();

  state.filtered = state.items
    .map((item) => ({ ...item, _matchedCount: 0 }))
    .filter((item) => {
      if (market !== "ALL" && item.market !== market) return false;
      if (type !== "ALL" && item.securityType !== type) return false;
      if (query) {
        const haystack = `${item.code} ${item.name}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return matchesSelectedFilters(item, selectedFilters, mode);
    });

  sortResults();
  state.visibleCount = PAGE_SIZE;
  renderResults();
  renderActiveChips();
  updateSelectedCounter();
  els.previewCountText.textContent = `符合 ${formatNumber(state.filtered.length)} 檔`;
}

function sortResults() {
  const key = els.sortSelect.value;
  const valueOf = (item) => {
    if (key === "score") return item._matchedCount || item.score || 0;
    if (key === "changePercent") return item.changePercent ?? -Infinity;
    if (key === "volume") return item.volume ?? -Infinity;
    if (key === "amount") return item.amount ?? -Infinity;
    if (key === "rs") return item.indicators?.rs ?? -Infinity;
    if (key === "code") return item.code;
    return item.score ?? 0;
  };

  state.filtered.sort((a, b) => {
    if (key === "code") return String(a.code).localeCompare(String(b.code), "zh-Hant");
    return Number(valueOf(b)) - Number(valueOf(a));
  });
}

function renderActiveChips() {
  const chips = [];
  if (els.marketSelect.value !== "ALL") chips.push(els.marketSelect.value === "TWSE" ? "上市" : "上櫃");
  if (els.typeSelect.value !== "ALL") chips.push(els.typeSelect.value === "STOCK" ? "股票" : "ETF");
  getSelectedFilters().forEach((filterId) => chips.push(getFilterInfo(filterId)?.title || filterId));
  els.activeChips.innerHTML = chips.length
    ? chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("")
    : `<span class="chip muted-chip">未選條件：顯示全部資料</span>`;
}

function getTrendClass(value) {
  if (Number(value) > 0) return "up";
  if (Number(value) < 0) return "down";
  return "flat";
}

function renderResults() {
  const selected = getSelectedFilters();
  const visible = state.filtered.slice(0, state.visibleCount);
  const total = state.filtered.length;
  els.resultHeading.textContent = `符合 ${formatNumber(total)} 檔`;
  els.resultSubtitle.textContent = selected.length
    ? `已選 ${selected.length} 個條件｜${els.modeSelect.options[els.modeSelect.selectedIndex].textContent}`
    : "未選條件，依市場 / 商品 / 搜尋條件顯示。";

  if (!visible.length) {
    els.resultsList.innerHTML = `<div class="empty-state">沒有符合條件的資料。若剛部署，請先執行 GitHub Actions 產生今日資料。</div>`;
    els.loadMoreBtn.hidden = true;
    return;
  }

  els.resultsList.innerHTML = visible.map((item, index) => renderStockRow(item, index + 1)).join("");
  els.loadMoreBtn.hidden = state.visibleCount >= total;
}

function renderStockRow(item, rank) {
  const id = `${item.market}:${item.code}`;
  const watched = state.watch.has(id);
  const trendClass = getTrendClass(item.change);
  const matchedLabels = getMatchedLabels(item);
  const matchedText = item._matchedCount ? `${item._matchedCount}項` : `${item.score ?? 0}分`;
  const revenueYoY = item.fundamentalMetrics?.revenueYoY;
  const foreignNet = item.chipMetrics?.foreignNet;
  const trustNet = item.chipMetrics?.trustNet;
  const closeText = formatPrice(item.close);
  const changeText = item.change === null || item.change === undefined
    ? "-"
    : `${Number(item.change) > 0 ? "+" : ""}${formatPrice(item.change)}`;
  const changePercentText = item.changePercent === null || item.changePercent === undefined ? "" : ` ${formatPercent(item.changePercent)}`;

  return `
    <article class="stock-row" data-stock-id="${escapeHtml(id)}">
      <div class="row-rank">${rank}</div>
      <div class="row-main">
        <div class="row-line1">
          <div class="identity">
            <h3>${escapeHtml(item.code)} ${escapeHtml(item.name)}</h3>
            <p>${escapeHtml(item.marketName || item.market)}｜${escapeHtml(item.securityType || "-")}｜符合 ${escapeHtml(matchedText)}</p>
          </div>
          <button class="watch-btn" type="button" data-watch-id="${escapeHtml(id)}" aria-label="${watched ? "移除" : "加入"}自選股">${watched ? "★" : "☆"}</button>
        </div>

        <div class="row-line2">
          <div class="price-box">
            <strong>${closeText}</strong>
            <span class="${trendClass}">${changeText}${changePercentText}</span>
          </div>
        </div>

        <div class="metric-grid" aria-label="比較指標">
          <div class="metric"><span>RS</span><strong>${item.indicators?.rs ?? "-"}</strong></div>
          <div class="metric"><span>成交量</span><strong>${formatCompact(item.volume)}</strong></div>
          <div class="metric"><span>成交額</span><strong>${formatCompact(item.amount)}</strong></div>
          <div class="metric"><span>營收 YoY</span><strong>${revenueYoY === null || revenueYoY === undefined ? "-" : formatPercent(revenueYoY)}</strong></div>
          <div class="metric"><span>外資</span><strong>${foreignNet === null || foreignNet === undefined ? "-" : formatCompact(foreignNet)}</strong></div>
          <div class="metric"><span>投信</span><strong>${trustNet === null || trustNet === undefined ? "-" : formatCompact(trustNet)}</strong></div>
        </div>

        <div class="match-line">
          ${matchedLabels.length ? matchedLabels.slice(0, 6).map((label) => `<span class="match-pill">${escapeHtml(label)}</span>`).join("") : `<span class="match-pill">尚無符合條件</span>`}
        </div>
      </div>
    </article>
  `;
}

function getMatchedLabels(item) {
  const labels = [];
  getAllFilters().forEach((filter) => {
    if (item.technical?.[filter.id] || item.fundamental?.[filter.id] || item.chip?.[filter.id]) labels.push(filter.title);
  });
  return labels;
}

function renderWatchlist() {
  const watchedItems = state.items.filter((item) => state.watch.has(`${item.market}:${item.code}`));
  if (!watchedItems.length) {
    els.watchList.innerHTML = `<div class="empty-state">尚未加入自選股。請到結果清單點選星號。</div>`;
    return;
  }
  els.watchList.innerHTML = watchedItems.map((item, index) => renderStockRow({ ...item, _matchedCount: item.score ?? 0 }, index + 1)).join("");
}

function setView(view) {
  state.activeView = view;
  els.app.dataset.view = view;
  document.querySelectorAll(".view").forEach((el) => el.classList.remove("active"));
  document.querySelector(`#view${view[0].toUpperCase()}${view.slice(1)}`)?.classList.add("active");
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  els.mainScroll.scrollTop = 0;
  if (view === "watch") renderWatchlist();
}

function resetFilters() {
  state.selected.clear();
  els.searchInput.value = "";
  els.marketSelect.value = "ALL";
  els.typeSelect.value = "ALL";
  els.modeSelect.value = "AND";
  renderFilterGroups();
  applyFilters();
}

async function loadData() {
  els.dataUpdatedAt.textContent = "資料更新：讀取中";
  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.raw = data;
    state.items = Array.isArray(data.items) ? data.items : [];

    const updated = formatDateTime(data.updatedAt);
    els.dataUpdatedAt.textContent = `資料更新：${updated}`;
    els.settingsDataTime.textContent = updated;
    els.appUpdatedAt.textContent = `版本 ${APP_VERSION}｜${data.dataDate ? `資料日 ${data.dataDate}` : "等待 Actions"}`;

    const counts = data.counts || {};
    els.marketSummary.textContent = `上市 ${formatNumber(counts.TWSE || 0)}｜上櫃 ${formatNumber(counts.TPEX || 0)}`;
    els.totalCountText.textContent = formatNumber(data.totalCount || state.items.length);

    applyFilters();
    renderWatchlist();

    if (!state.items.length) showToast(data.message || "尚無資料，請先執行 GitHub Actions。");
    else showToast("股票資料已讀取。");
  } catch (error) {
    console.error(error);
    els.dataUpdatedAt.textContent = "資料更新：讀取失敗";
    els.settingsDataTime.textContent = "讀取失敗";
    els.resultsList.innerHTML = `<div class="empty-state">讀取 screening.json 失敗，請確認檔案已上傳或 Actions 已成功執行。</div>`;
    showToast("資料讀取失敗，請稍後再試。GitHub Pages 可能仍在部署。");
  }
}

function bindEvents() {
  els.filterGroups.addEventListener("change", (event) => {
    const input = event.target.closest("input[data-filter-id]");
    if (!input) return;
    const id = input.dataset.filterId;
    if (input.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderFilterGroups();
    applyFilters();
  });

  els.filterGroups.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-group-toggle]");
    if (!button) return;
    const group = FILTER_GROUPS.find((item) => item.id === button.dataset.groupToggle);
    if (!group) return;
    const enabled = group.filters.filter((filter) => !filter.disabled);
    const allSelected = enabled.every((filter) => state.selected.has(filter.id));
    enabled.forEach((filter) => {
      if (allSelected) state.selected.delete(filter.id);
      else state.selected.add(filter.id);
    });
    renderFilterGroups();
    applyFilters();
  });

  els.runFilterBtn.addEventListener("click", () => {
    applyFilters();
    setView("results");
  });

  els.clearFilterBtn.addEventListener("click", resetFilters);
  els.clearFilterInlineBtn.addEventListener("click", resetFilters);

  [els.modeSelect, els.marketSelect, els.typeSelect, els.sortSelect].forEach((el) => el.addEventListener("change", applyFilters));

  els.searchInput.addEventListener("input", () => {
    window.clearTimeout(els.searchInput.timer);
    els.searchInput.timer = window.setTimeout(applyFilters, 140);
  });

  els.loadMoreBtn.addEventListener("click", () => {
    state.visibleCount += PAGE_SIZE;
    renderResults();
  });

  document.body.addEventListener("click", (event) => {
    const watchButton = event.target.closest("button[data-watch-id]");
    if (!watchButton) return;
    const id = watchButton.dataset.watchId;
    if (state.watch.has(id)) {
      state.watch.delete(id);
      showToast("已從自選股移除。");
    } else {
      state.watch.add(id);
      showToast("已加入自選股。");
    }
    saveWatchlist();
    renderResults();
    renderWatchlist();
  });

  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  els.manualRefreshBtn.addEventListener("click", loadData);
  els.themeToggle.addEventListener("click", () => applyTheme(document.documentElement.classList.contains("dark") ? "light" : "dark"));
  els.checkUpdateBtn.addEventListener("click", () => checkForUpdate({ silent: false }));
  els.manualUpdateBtn.addEventListener("click", () => checkForUpdate({ silent: false }));
  els.reloadAppBtn.addEventListener("click", applyAppUpdate);
}

async function checkForUpdate(options = {}) {
  const silent = options.silent ?? true;
  try {
    const config = window.STOCK_RADAR_UPDATE_CONFIG || {};
    const response = await fetch(`${config.versionUrl || "./version.json"}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.version && data.version !== APP_VERSION) {
      showUpdateBanner(`發現新版本 ${data.version}`, "點選更新會重新整理並取得最新程式。");
      return true;
    }
    if (!silent) showToast("目前已是最新版本。");
    return false;
  } catch (error) {
    console.warn("Update check failed", error);
    if (!silent) showToast("無法檢查版本，請稍後再試。");
    return false;
  }
}

function applyAppUpdate() {
  if (state.serviceWorkerWaiting) {
    state.serviceWorkerWaiting.postMessage({ type: "SKIP_WAITING" });
    return;
  }
  window.location.reload();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js");
    registration.update?.();

    if (registration.waiting) {
      state.serviceWorkerWaiting = registration.waiting;
      showUpdateBanner("新版已下載", "點選更新即可切換到新版程式。");
    }

    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          state.serviceWorkerWaiting = worker;
          showUpdateBanner("新版已準備好", "點選更新即可套用新版。");
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (state.reloadingForUpdate) return;
      state.reloadingForUpdate = true;
      window.location.reload();
    });
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

function preventDoubleTapZoom() {
  let lastTouchEnd = 0;
  document.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
}

function init() {
  els.app.dataset.view = "filter";
  initTheme();
  preventDoubleTapZoom();
  loadWatchlist();
  renderFilterGroups();
  bindEvents();
  registerServiceWorker();
  loadData();
  checkForUpdate({ silent: true });

  const minutes = window.STOCK_RADAR_UPDATE_CONFIG?.checkIntervalMinutes || 15;
  window.setInterval(() => checkForUpdate({ silent: true }), minutes * 60 * 1000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      checkForUpdate({ silent: true });
      loadData();
    }
  });
}

init();
