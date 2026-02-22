/* service-worker.js
   PWA update strategy for GitHub Pages
   - Network-first for HTML/JS/CSS (always try to get latest)
   - Cache-first for images/icons (fast)
   - Cleans old caches on activate
*/

const VERSION = "2026-02-22-1"; // 👈 súbelo cada vez que publiques cambios importantes
const CACHE_STATIC = `pokedb-static-${VERSION}`;
const CACHE_PAGES  = `pokedb-pages-${VERSION}`;

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./data.schema.js",
  "./services.api.js",
  "./ui.filters.js",
  "./ui.render.js",
  "./utils.js",
  "./pokemon.webp",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Instala: precache básico
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIC);
    await cache.addAll(STATIC_ASSETS);
    await self.skipWaiting();
  })());
});

// Activa: limpia cachés viejos
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith("pokedb-") && ![CACHE_STATIC, CACHE_PAGES].includes(k))
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Mensajes desde la app (para forzar update inmediato)
self.addEventListener("message", (event) => {
  const type = event?.data?.type;
  if (type === "SKIP_WAITING") self.skipWaiting();
});

// Fetch: estrategias por tipo
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Evita cachear Apps Script / Google endpoints (ya los manejas por red)
  if (url.origin.includes("google.com") || url.origin.includes("script.google.com")) {
    return; // deja que el navegador haga lo suyo
  }

  // Navegación (HTML): network-first + fallback cache
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(networkFirst(req, CACHE_PAGES));
    return;
  }

  // JS/CSS: network-first (para agarrar updates rápido)
  const isCode =
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".webmanifest");

  if (isCode) {
    event.respondWith(networkFirst(req, CACHE_STATIC));
    return;
  }

  // Imágenes/íconos: cache-first
  const isImage =
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".jpeg") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico");

  if (isImage) {
    event.respondWith(cacheFirst(req, CACHE_STATIC));
    return;
  }

  // Default: network-first
  event.respondWith(networkFirst(req, CACHE_STATIC));
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req, { cache: "no-store" });
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;

    // Fallback para navegaciones offline
    if (req.mode === "navigate") {
      const cachedIndex = await cache.match("./index.html");
      if (cachedIndex) return cachedIndex;
    }
    throw new Error("Offline and no cache");
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;

  const fresh = await fetch(req);
  if (fresh && fresh.ok) cache.put(req, fresh.clone());
  return fresh;
}