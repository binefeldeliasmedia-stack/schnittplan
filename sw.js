/* Service Worker: macht die App installierbar und startfaehig ohne Netz.
   Nur das Geruest wird zwischengespeichert - niemals Daten aus Google. */
const CACHE = "schnittplan-v4";
const GERUEST = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(GERUEST)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Alles von Google und jede fremde Herkunft geht immer direkt ins Netz.
  if (url.origin !== location.origin || e.request.method !== "GET") return;

  // Geruest: erst Netz (damit Updates ankommen), sonst Cache.
  e.respondWith(
    fetch(e.request, {cache:"no-cache"})   // HTTP-Zwischenspeicher umgehen
      .then(r => {
        const kopie = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, kopie));
        return r;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
