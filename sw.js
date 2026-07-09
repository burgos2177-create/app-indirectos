// Service worker de app-indirectos.
//
// Objetivo: que cada despliegue se vea al instante, sin necesidad de hard-refresh.
//
// Problema que resuelve: la app usa módulos ES nativos (sin bundler). El
// navegador cachea cada .js por su URL; como las URLs no cambian entre deploys,
// se quedaban servidas versiones viejas hasta que expiraba el caché de GitHub
// Pages (~10 min) o se hacía Ctrl+Shift+R.
//
// Estrategia: NO cachea nada. Solo intercepta las peticiones GET del mismo
// origen a archivos de la app (JS/CSS/HTML/…) y las reenvía a la red saltando
// el caché HTTP del navegador (cache: 'no-store'). Así siempre se obtiene lo
// último que publicó GitHub Pages. Las peticiones cross-origin (Firebase, CDN
// de gstatic) no se tocan.

self.addEventListener('install', () => {
  // Activa la versión nueva del SW de inmediato, sin esperar.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Toma control de las pestañas ya abiertas sin esperar a que se cierren.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // Firebase / gstatic: no tocar.

  const esAsset = /\.(?:js|mjs|css|html|json|svg)$/i.test(url.pathname);
  const esNavegacion = req.mode === 'navigate';
  if (!esAsset && !esNavegacion) return;

  // Siempre a la red, sin usar el caché del navegador.
  event.respondWith(fetch(req, { cache: 'no-store' }));
});
