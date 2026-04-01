/* GitHub Pages: 예전 index.html이 캐시에 남으면 VITE_DEPLOY_TAG(빌드 SHA)가 영원히 안 바뀐 것처럼 보임 → HTML은 네트워크 우선 */
const CACHE_NAME = "eor-pwa-v19-eoroff-sw-network-first";
const APP_SHELL = [
  "./manifest.json",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }

  const crossOrigin = url.origin !== self.location.origin;
  const looksLikeApi = url.pathname.includes("/api/");
  if (crossOrigin || looksLikeApi) {
    event.respondWith(fetch(event.request));
    return;
  }

  const path = url.pathname;
  const isHtmlShell =
    event.request.mode === "navigate" ||
    event.request.destination === "document" ||
    path.endsWith("index.html") ||
    path.endsWith("/eoroff") ||
    path.endsWith("/eoroff/");

  if (isHtmlShell) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((res) => res)
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  /* 빌드마다 해시가 바뀌는 JS/CSS·폰트는 네트워크 우선 → 배포 직후에도 최신 번들을 빨리 가져옴 */
  const isHashedAsset =
    path.includes("/assets/") || /\.(?:js|mjs|css|woff2?)$/i.test(path);

  if (isHashedAsset) {
    event.respondWith(
      fetch(event.request, { cache: "no-cache" })
        .then((response) => {
          if (response.ok) {
            const cloned = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  /* 그 외(아이콘 등): 캐시 우선 */
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          const cloned = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
