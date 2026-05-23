const CACHE_NAME = "stock-radar-v1-3";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon.svg",
  "./update-config.js",
  "./version.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const networkFirstFiles = [
    "/screening.json",
    "/latest.json",
    "/meta.json",
    "/history-prices.json",
    "/history-revenue.json",
    "/history-financials.json",
    "/history-chip.json",
    "/version.json"
  ];

  if (networkFirstFiles.some((path) => url.pathname.endsWith(path))) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
