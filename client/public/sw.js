const CACHE_NAME = "app-assets-v3";
const OFFLINE_URL = "/offline.html";
// Never precache "/" (the app shell). Its HTML embeds Vite-hashed asset URLs
// that change on every publish, so a cached shell points at dead chunks.
const urlsToCache = [
  OFFLINE_URL,
  "/icon/icon-192.png",
  "/icon/icon-512.png",
  "/icon/icon-maskable-192.png",
  "/icon/icon-maskable-512.png",
];

// Install event - cache the offline page and icons (never the app shell).
// allSettled so one missing asset does not abort the whole install.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(urlsToCache.map((url) => cache.add(url))),
      ),
  );
});

// A new worker waits until the open page asks it to take over, or until the
// next visit. Authenticated /api responses are never stored.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// Fetch event - network first, fall back to cache
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) {
    return;
  }

  if (
    url.pathname.startsWith("/auth") ||
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/webhook")
  ) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches
          .match(OFFLINE_URL)
          .then((cached) => cached ?? new Response("Offline", { status: 503 })),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (!response.ok) {
          return response;
        }
        const responseToCache = response.clone();
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(event.request, responseToCache));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          }),
        );
      })
      .then(() => self.clients.claim()),
  );
});

// Handle push notifications - only show if app is not in focus
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        const isAppInFocus = clientList.some((client) => client.focused);

        if (!isAppInFocus) {
          return self.registration.showNotification(data.title, data.options);
        }
      }),
  );
});

// Handle notification clicks - opens/focuses the app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("/");
    }),
  );
});
