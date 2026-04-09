// Push notification handler for Eulesia service worker
// This file is imported by the workbox-generated SW via importScripts

// Clean up stale runtime caches from previous SW versions
self.addEventListener("activate", (event) => {
  const STALE_CACHES = ["eulesia-api", "api-cache"];
  event.waitUntil(Promise.all(STALE_CACHES.map((name) => caches.delete(name))));
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Eulesia", body: event.data.text() };
  }

  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.webp",
    badge: "/icons/icon-96.webp",
    data: { url: data.url || "/agora" },
    tag: data.type || "default",
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "Eulesia", options),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/agora";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing window if available
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        // Open new window
        return self.clients.openWindow(url);
      }),
  );
});
