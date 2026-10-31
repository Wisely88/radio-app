const CACHE_NAME = "dreamfm-pages-shell-v6";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/three-quarter-mark.svg",
  "./scripts/on-demand.js",
  "./scripts/on-demand-core.js",
  "./scripts/multimode.js",
  "./scripts/play-queue.js",
  "./scripts/scene-entry-fix.js",
  "./scripts/ipod-mobile.js",
  "./styles/multimode.css",
  "./styles/mobile-tune.css",
  "./styles/mobile-player-controls.css",
  "./styles/product-polish.css",
  "./styles/play-queue.css",
  "./styles/home-modern.css",
  "./styles/ipod-mobile.css",
  "./styles/mode-switch.css",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-180.png"
];

const DATA_FILES = [
  "/data/audiobooks.json",
  "/data/podcasts.json",
  "/data/stations.json",
  "/audio-source-health.json",
  "/station-health.json",
  "/data/catalog-version.json"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("dreamfm-pages-shell-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isDataRequest(url) {
  return DATA_FILES.some(path => url.pathname.endsWith(path));
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put("./index.html", response.clone()));
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }

  if (isDataRequest(url)) {
    // 带 ?v= 版本串的数据请求：版本即新鲜度，可安全走 cache-first；
    // 命中新版本后顺手清理同路径的旧版本缓存，避免无限膨胀。
    if (url.searchParams.has("v")) {
      event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => {
          cache.keys().then(keys => keys.forEach(k => {
            const ku = new URL(k.url);
            if (ku.pathname === url.pathname && k.url !== request.url) cache.delete(k);
          }));
          cache.put(request, response.clone());
        });
        return response;
      })));
      return;
    }
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request)));
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then(exact => exact || caches.match(request, { ignoreSearch: true })))
  );
});
