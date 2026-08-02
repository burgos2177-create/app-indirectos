// Service worker de app-indirectos — network-first, a prueba de señal intermitente.
//
// Objetivo: que cada despliegue se vea rápido SIN que la app se caiga en obra.
//
// Historia: la versión anterior usaba fetch(req, {cache:'no-store'}) sin
// fallback — si la red fallaba (típico en obra con señal intermitente), el
// respondWith recibía una promesa rechazada y Safari/Chrome mostraban página
// en blanco ("Load failed"). Mismo bug que ya se corrigió en app-estimaciones.
//
// Estrategia: red primero (código fresco); si la red falla, caché; si es una
// navegación sin caché, el shell (index.html). NUNCA devuelve vacío.
const CACHE = 'indir-cache-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const k of await caches.keys()) { if (k !== CACHE) await caches.delete(k); }
  await self.clients.claim();
})()));

// Pide a la RED saltando el caché HTTP del navegador. Sin esto, GitHub Pages
// responde Cache-Control: max-age=600 y los módulos ES (que se importan por URL
// fija, sin ?v=) se quedaban hasta 10 minutos servidos de caché: se desplegaba
// un cambio y no se veía. Si el navegador rechaza el override o no hay red, se
// reintenta normal y el catch de arriba cae a caché — nunca pantalla en blanco.
async function redFresca(req) {
  try { return await fetch(req, { cache: 'no-store' }); }
  catch (e) { return await fetch(req); }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // Firebase / gstatic: no tocar.

  const esAsset = /\.(?:js|mjs|css|html|json|svg)$/i.test(url.pathname);
  const esNavegacion = req.mode === 'navigate';
  if (!esAsset && !esNavegacion) return;

  event.respondWith((async () => {
    try {
      const res = await redFresca(req);        // network-first, saltando el caché HTTP
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (e) {
      // Red caída o señal intermitente → servir de caché.
      const cached = await caches.match(req);
      if (cached) return cached;
      // Navegación sin caché → servir el shell para que la SPA arranque igual.
      if (esNavegacion) {
        const shell = (await caches.match('./index.html')) || (await caches.match('index.html')) || (await caches.match('./'));
        if (shell) return shell;
      }
      // Último recurso: una respuesta válida (nunca undefined → nunca pantalla en blanco).
      return new Response('Sin conexión. Reintenta cuando tengas señal.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
