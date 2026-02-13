const cacheName = "doglog-static-v3";
const staticAssets = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/goals.html",
  "/goals.css",
  "/goals.js",
  "/goals-library.html",
  "/goals-library.css",
  "/goals-library.js",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(staticAssets)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)),
      ),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(request).then((cached) => {
        if (cached) {
          return cached;
        }
        return caches.match("/");
      }),
    ),
  );
});
