/**
 * Service Worker « ISZTRANSPORT »
 * ---------------------------------------------------------------
 * Stratégies de cache :
 *  - Navigations (/)   : réseau d'abord, cache en secours, puis offline.html
 *  - GET /api/*        : réseau d'abord, réponse mise en cache, secours cache
 *  - Assets statiques  : cache-first pour /_next/static (immutables),
 *                        stale-while-revalidate pour le reste
 *  - Mutations (POST/PUT/DELETE) : jamais interceptées — gérées par la
 *    file d'attente hors-ligne de l'application (localStorage).
 */

const VERSION = "v10";
const PRECACHE = `isztransport-precache-${VERSION}`;
const RUNTIME = `isztransport-runtime-${VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-192.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // allSettled : ne pas faire échouer l'installation si une ressource manque
      await Promise.allSettled(
        PRECACHE_URLS.map((u) => cache.add(new Request(u, { cache: "reload" })))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== PRECACHE && k !== RUNTIME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // mutations : gérées par la file d'attente JS

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // domaines externes : passer

  // --- Navigations (pages HTML) ---
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) {
            const cache = await caches.open(RUNTIME);
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch {
          const runtime = await caches.open(RUNTIME);
          const precache = await caches.open(PRECACHE);
          return (
            (await runtime.match(req)) ||
            (await runtime.match("/")) ||
            (await precache.match("/")) ||
            (await precache.match("/offline.html")) ||
            new Response("Vous êtes hors ligne.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }
      })()
    );
    return;
  }

  // --- API GET : réseau d'abord + cache en secours ---
  if (url.pathname.startsWith("/api/")) {
    // Authentification : JAMAIS mise en cache (état de session toujours à jour)
    if (url.pathname.startsWith("/api/auth")) return;
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME);
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.status === 200) {
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch {
          const cached = await cache.match(req);
          if (cached) return cached;
          return new Response(JSON.stringify({ error: "offline", offline: true }), {
            status: 503,
            headers: { "Content-Type": "application/json", "X-Offline": "1" },
          });
        }
      })()
    );
    return;
  }

  // --- Assets Next.js (chunks, images) : réseau d'abord (en dev les noms
  // de chunks ne sont pas stables), cache en secours ---
  if (url.pathname.startsWith("/_next/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME);
        const cached = await cache.match(req);
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.status === 200) {
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch {
          return cached || new Response("Ressource indisponible hors ligne.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      })()
    );
    return;
  }

  // --- Assets statiques (icônes, fonts…) : cache-first ---
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      const immutable =
        url.pathname === "/favicon.ico" ||
        url.pathname.startsWith("/icon-") ||
        url.pathname.startsWith("/apple-touch-icon");
      if (cached && immutable) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200 && fresh.type === "basic") {
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        if (cached) return cached;
        return new Response("Ressource indisponible hors ligne.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })()
  );
});
