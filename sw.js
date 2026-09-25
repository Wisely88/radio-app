const CACHE_NAME = "dreamfm-pages-shell-v2";
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
  "./styles/multimode.css",
  "./styles/mobile-tune.css",
  "./styles/mobile-player-controls.css",
  "./styles/product-polish.css",
  "./styles/play-queue.css"
];

const DATA_FILES = [
  "/data/audiobooks.json",
  "/data/podcasts.json",
  "/data/stations.json",
  "/audio-source-health.json",
  "/station-health.json"
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
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request)));
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
