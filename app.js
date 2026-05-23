const APP_VERSION = "V1_2";
const DATA_URL = "./screening.json";
const WATCH_KEY = "stock-radar-watchlist-v1";
const THEME_KEY = "stock-radar-theme";
const PAGE_SIZE = 80;

const FILTER_GROUPS = [
  {
    id: "technical",
    title: "技術面",
    icon: "📊",
    filters: [
      { id: "rsAbove90", title: "RS 指標大於 90", subtitle: "相對大盤強度" },
      { id: "nearHigh22", title: "距上月高點 ≤ 5%", subtitle: "近 22 交易日" },
      { id: "maShortBull", title: "短期均線排列正確", subtitle: "MA5 > MA10 > MA20" },
      { id: "maMidBull", title: "中長期均線排列正確", subtitle: "MA20 > MA60 > MA120" },
      { id: "aboveDeduction", title: "站上扣抵值", subtitle: "收盤 > 20 / 60 日前股價" }
    ]
  },
  {
    id: "fundamental",
    title: "基本面",
    icon: "📈",
    filters: [
      { id: "revenueHigh", title: "營收創歷史或同期高", subtitle: "待接月營收資料", disabled: true },
      { id: "revenueYoY2M", title: "年增率連 2 月 > 20%", subtitle: "待接月營收 YoY", disabled: true },
      { id: "revenueMoM2M", title: "月增率連 2 月 > 20%", subtitle: "待接月營收 MoM", disabled: true },
      { id: "marginGrowth", title: "毛利率、營益率較去年成長", subtitle: "待接季財報", disabled: true },
      { id: "profitable", title: "公司沒有虧損", subtitle: "待接季財報淨利", disabled: true }
    ]
  },
  {
    id: "chip",
    title: "籌碼面",
    icon: "🎯",
    filters: [
      { id: "majorHolderIncrease", title: "籌碼集中度增加", subtitle: "待接集保週資料", disabled: true },
      { id: "brokerDiffNegative", title: "近期買賣家數差 < 0", subtitle: "免費來源不穩，暫不支援", disabled: true },
      { id: "foreignBuy", title: "外資買超", subtitle: "待接三大法人資料", disabled: true },
      { id: "trustBuy", title: "投信買超", subtitle: "待接三大法人資料", disabled: true },
      { id: "largeHolderRatioUp", title: "大戶持股比例增加", subtitle: "待接集保持股結構", disabled: true },
      { id: "institutionalQuarterHigh", title: "法人持股創一季新高", subtitle: "待累積法人資料", disabled: true }
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
  activeView: "filter"
};

const els = {
  dataStatus: document.querySelector("#dataStatus"),
  marketSummary: document.querySelector("#marketSummary"),
  coverageText: document.querySelector("#coverageText"),
  filterGroups: document.querySelector("#filterGroups"),
  runFilterBtn: document.querySelector("#runFilterBtn"),
  reloadDataBtn: document.querySelector("#reloadDataBtn"),
  manualRefreshBtn: document.querySelector("#manualRefreshBtn"),
  clearFilterBtn: document.querySelector("#clearFilterBtn"),
  modeSelect: document.querySelector("#modeSelect"),
  marketSelect: document.querySelector("#marketSelect"),
  typeSelect: document.querySelector("#typeSelect"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  resultTitle: document.querySelector("#resultTitle"),
  resultSubtitle: document.querySelector("#resultSubtitle"),
  activeChips: document.querySelector("#activeChips"),
  resultsList: document.querySelector("#resultsList"),
  loadMoreBtn: document.querySelector("#loadMoreBtn"),
  watchList: document.querySelector("#watchList"),
  themeToggle: document.querySelector("#themeToggle"),
  versionBadge: document.querySelector("#versionBadge"),
  toast: document.querySelector("#toast"),
  mainScroll: document.querySelector("#mainScroll")
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

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const num = Number(value);
  const digits = num >= 100 ? 1 : 2;
  return num.toLocaleString("zh-TW", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function formatTime(value) {
  if (!value) return "尚未更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未更新";
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2600);
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
  const resolved = theme === "light" ? "light" : "dark";
  document.documentElement.classList.toggle("light", resolved === "light");
  els.themeToggle.textContent = resolved === "light" ? "🌙" : "☀️";
  localStorage.setItem(THEME_KEY, resolved);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) {
    applyTheme(saved);
    return;
  }
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches;
  applyTheme(prefersLight ? "light" : "dark");
}

function getAllFilters() {
  return FILTER_GROUPS.flatMap((group) => group.filters.map((filter) => ({ ...filter, groupId: group.id })));
}

function getFilterInfo(filterId) {
  return getAllFilters().find((item) => item.id === filterId);
}

function renderFilterGroups() {
  els.filterGroups.innerHTML = FILTER_GROUPS.map((group) => {
    const enabledFilters = group.filters.filter((filter) => !filter.disabled);
    const selectedCount = group.filters.filter((filter) => state.selected.has(filter.id)).length;
    const totalCount = group.filters.length;
    const options = group.filters.map((filter) => {
      const checked = state.selected.has(filter.id) ? "checked" : "";
      const disabled = filter.disabled ? "disabled" : "";
      const disabledClass = filter.disabled ? " disabled" : "";
      return `
        <label class="filter-option${disabledClass}">
          <input type="checkbox" data-filter-id="${escapeHtml(filter.id)}" ${checked} ${disabled} />
          <span>
            <strong>${escapeHtml(filter.title)}</strong>
            <small>${escapeHtml(filter.subtitle)}</small>
          </span>
        </label>
      `;
    }).join("");

    const allSelected = enabledFilters.length > 0 && enabledFilters.every((filter) => state.selected.has(filter.id));

    return `
      <article class="filter-card" data-group-id="${escapeHtml(group.id)}">
        <div class="filter-card-header">
          <div class="filter-title">
            <span class="emoji">${group.icon}</span>
            <h3>${escapeHtml(group.title)}</h3>
          </div>
          <div class="filter-card-actions">
            <span class="filter-count">${selectedCount}/${totalCount}</span>
            <button class="select-all-btn" type="button" data-group-toggle="${escapeHtml(group.id)}" ${enabledFilters.length === 0 ? "disabled" : ""}>${allSelected ? "取消" : "全選"}</button>
          </div>
        </div>
        <div class="filter-options">${options}</div>
      </article>
    `;
  }).join("");
}

function getSelectedFilters() {
  return [...state.selected];
}

function matchesSelectedFilters(item, selectedFilters, mode) {
  if (selectedFilters.length === 0) return true;

  const matched = selectedFilters.filter((filterId) => {
    return item.technical?.[filterId] === true || item.fundamental?.[filterId] === true || item.chip?.[filterId] === true;
  }).length;

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
}

function sortResults() {
  const key = els.sortSelect.value;
  const valueOf = (item) => {
    if (key === "score") return item._matchedCount ?? item.score ?? 0;
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
  const selected = getSelectedFilters();
  const chips = [];

  if (els.marketSelect.value !== "ALL") chips.push(els.marketSelect.value === "TWSE" ? "上市" : "上櫃");
  if (els.typeSelect.value !== "ALL") chips.push(els.typeSelect.value === "STOCK" ? "股票" : "ETF");
  selected.forEach((filterId) => chips.push(getFilterInfo(filterId)?.title || filterId));

  els.activeChips.innerHTML = chips.length
    ? chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("")
    : `<span class="chip">未選條件：顯示全部資料</span>`;
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

  els.resultTitle.textContent = `符合 ${formatNumber(total)} 檔`;
  els.resultSubtitle.textContent = selected.length
    ? `已選 ${selected.length} 個條件，模式：${els.modeSelect.options[els.modeSelect.selectedIndex].textContent}`
    : "未選條件，依市場 / 商品 / 搜尋條件顯示。";

  if (!visible.length) {
    els.resultsList.innerHTML = `<div class="stock-card empty-state">沒有符合條件的資料。若剛部署，請先執行 GitHub Actions 產生今日資料。</div>`;
    els.loadMoreBtn.hidden = true;
    return;
  }

  els.resultsList.innerHTML = visible.map(renderStockCard).join("");
  els.loadMoreBtn.hidden = state.visibleCount >= total;
}

function renderStockCard(item) {
  const id = `${item.market}:${item.code}`;
  const watched = state.watch.has(id);
  const change = item.change ?? null;
  const changePercent = item.changePercent ?? null;
  const trendClass = getTrendClass(change);
  const matchedText = item._matchedCount ? `符合 ${item._matchedCount}` : `分數 ${item.score ?? 0}`;
  const tags = getMatchedLabels(item).slice(0, 5);

  return `
    <article class="stock-card" data-stock-id="${escapeHtml(id)}">
      <div class="stock-main">
        <div class="stock-code">
          <button class="watch-btn" type="button" data-watch-id="${escapeHtml(id)}" aria-label="${watched ? "移除" : "加入"}自選股">${watched ? "★" : "☆"}</button>
          <div>
            <h3>${escapeHtml(item.code)} ${escapeHtml(item.name)}</h3>
            <p><span class="badge">${item.marketName || item.market}</span> <span class="badge">${item.securityType}</span> ${escapeHtml(matchedText)}</p>
          </div>
        </div>
        <div class="price-box">
          <strong>${formatPrice(item.close)}</strong>
          <span class="${trendClass}">${change === null ? "-" : `${Number(change) > 0 ? "+" : ""}${formatPrice(change)}`} ${changePercent === null ? "" : `(${Number(changePercent).toFixed(2)}%)`}</span>
        </div>
      </div>
      <div class="stock-grid">
        <div class="metric"><span>RS</span><b>${item.indicators?.rs ?? "-"}</b></div>
        <div class="metric"><span>成交量</span><b>${formatNumber(item.volume)}</b></div>
        <div class="metric"><span>成交金額</span><b>${formatNumber(item.amount)}</b></div>
        <div class="metric"><span>MA 狀態</span><b>${item.technical?.maShortBull ? "短多" : item.technical?.maMidBull ? "中多" : "-"}</b></div>
      </div>
      <p class="match-list">${tags.length ? `符合：${tags.map(escapeHtml).join("、")}` : "目前沒有符合已支援的技術條件。"}</p>
    </article>
  `;
}

function getMatchedLabels(item) {
  const labels = [];
  getAllFilters().forEach((filter) => {
    if (item.technical?.[filter.id] || item.fundamental?.[filter.id] || item.chip?.[filter.id]) {
      labels.push(filter.title);
    }
  });
  return labels;
}

function renderWatchlist() {
  const watchedItems = state.items.filter((item) => state.watch.has(`${item.market}:${item.code}`));
  if (!watchedItems.length) {
    els.watchList.innerHTML = `<div class="stock-card empty-state">尚未加入自選股。</div>`;
    return;
  }
  els.watchList.innerHTML = watchedItems.map((item) => renderStockCard({ ...item, _matchedCount: item.score ?? 0 })).join("");
}

function setView(view) {
  state.activeView = view;
  document.querySelectorAll(".view").forEach((el) => el.classList.remove("active"));
  document.querySelector(`#view${view[0].toUpperCase()}${view.slice(1)}`)?.classList.add("active");
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  els.mainScroll.scrollTop = 0;
  if (view === "watch") renderWatchlist();
}

async function loadData() {
  els.dataStatus.textContent = "資料讀取中...";

  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    state.raw = data;
    state.items = Array.isArray(data.items) ? data.items : [];

    const updated = formatTime(data.updatedAt);
    const dataDate = data.dataDate || "尚未產生";
    els.dataStatus.textContent = `資料 ${dataDate}｜更新 ${updated}`;

    const counts = data.counts || {};
    els.marketSummary.textContent = `共 ${formatNumber(data.totalCount || state.items.length)} 檔`;
    els.coverageText.textContent = `上市 ${formatNumber(counts.TWSE || 0)}｜上櫃 ${formatNumber(counts.TPEX || 0)}｜股票 ${formatNumber(counts.STOCK || 0)}｜ETF ${formatNumber(counts.ETF || 0)}`;

    applyFilters();
    renderWatchlist();

    if (!state.items.length) {
      showToast(data.message || "尚無資料，請先執行 GitHub Actions。");
    } else {
      showToast("股票資料已更新。");
    }
  } catch (error) {
    console.error(error);
    els.dataStatus.textContent = "資料讀取失敗";
    els.resultsList.innerHTML = `<div class="stock-card empty-state">讀取 screening.json 失敗，請確認檔案已上傳或 Actions 已成功執行。</div>`;
    showToast("資料讀取失敗，請稍後再試。 注意：GitHub Pages 可能需要等待部署完成。 ");
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

  els.clearFilterBtn.addEventListener("click", () => {
    state.selected.clear();
    els.searchInput.value = "";
    els.marketSelect.value = "ALL";
    els.typeSelect.value = "ALL";
    renderFilterGroups();
    applyFilters();
  });

  [els.modeSelect, els.marketSelect, els.typeSelect, els.sortSelect].forEach((el) => {
    el.addEventListener("change", applyFilters);
  });

  els.searchInput.addEventListener("input", () => {
    window.clearTimeout(els.searchInput.timer);
    els.searchInput.timer = window.setTimeout(applyFilters, 160);
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

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  els.reloadDataBtn.addEventListener("click", loadData);
  els.manualRefreshBtn.addEventListener("click", loadData);

  els.themeToggle.addEventListener("click", () => {
    const isLight = document.documentElement.classList.contains("light");
    applyTheme(isLight ? "dark" : "light");
  });

  els.versionBadge.addEventListener("click", checkForUpdate);
}

async function checkForUpdate() {
  try {
    const config = window.STOCK_RADAR_UPDATE_CONFIG || {};
    const response = await fetch(`${config.versionUrl || "./version.json"}?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    if (data.version && data.version !== APP_VERSION) {
      showToast(`發現新版本 ${data.version}，重新整理後可更新。`);
    } else {
      showToast("目前已是最新版本。");
    }
  } catch {
    showToast("無法檢查版本，請稍後再試。");
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js");
    registration.update?.();
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
  initTheme();
  preventDoubleTapZoom();
  loadWatchlist();
  renderFilterGroups();
  bindEvents();
  registerServiceWorker();
  loadData();

  const minutes = window.STOCK_RADAR_UPDATE_CONFIG?.checkIntervalMinutes || 30;
  window.setInterval(checkForUpdate, minutes * 60 * 1000);
}

init();
