const CACHE_NAME = 'temirdaftar-v15';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/analytics.js',
  '/admin-marketing.js?v=20260917-2',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/apple-touch-icon.png'
];

function patchHtml(html) {
  html = html.replace(
    '<link rel="apple-touch-icon" href="logo.png.png">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">'
  );

  html = html.replace(
    '<link rel="icon" href="logo.png.png">',
    '<link rel="icon" type="image/png" href="/icons/icon-192.png">'
  );

  html = html.replace(
    '<button id="install-btn" onclick="showHomeScreenHelp()" style="background:white; color:#2563eb; border:none; padding:5px 8px; border-radius:5px; font-weight:bold; font-size:11px;">📱</button>',
    '<button id="install-btn" onclick="handleInstallButton()" aria-label="Ilovani yuklash" title="Ilovani yuklash" style="background:white; color:#2563eb; border:none; padding:5px 8px; border-radius:5px; font-weight:bold; font-size:11px; cursor:pointer;">📱</button>'
  );

  if (!html.includes('src="/analytics.js"')) {
    html = html.replace('</head>', '<script src="/analytics.js" defer></script>\n</head>');
  }

  if (html.includes('<title>TemirDaftar — Administrator</title>') && !html.includes('admin-marketing.js?v=20260917-2')) {
    html = html.replace('</head>', '<script src="/admin-marketing.js?v=20260917-2" defer></script>\n</head>');
  }

  if (!html.includes('function handleInstallButton()')) {
    const marker = "        /* ---- Bosh ekranga qo'shish (haqiqiy PWA fayllarsiz, oddiy yo'riqnoma) ---- */\n        function showHomeScreenHelp() {";
    const handler = `        /* ---- Ilovani o'rnatish/yuklash ---- */
        function handleInstallButton() {
            const ua = navigator.userAgent.toLowerCase();
            const isIos = /iphone|ipad|ipod/.test(ua);

            if (isIos) {
                showHomeScreenHelp();
                return;
            }

            window.location.href = '/TemirDaftar.apk';
        }

        /* ---- Bosh ekranga qo'shish (haqiqiy PWA fayllarsiz, oddiy yo'riqnoma) ---- */
        function showHomeScreenHelp() {`;
    html = html.replace(marker, handler);
  }

  return html;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('text/html')) {
            const html = await response.text();
            const patched = patchHtml(html);
            const patchedResponse = new Response(patched, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            });
            caches.open(CACHE_NAME).then((cache) => cache.put(request, patchedResponse.clone()));
            return patchedResponse;
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (!cached) return Response.error();
          const contentType = cached.headers.get('content-type') || '';
          if (contentType.includes('text/html')) {
            const patched = patchHtml(await cached.text());
            return new Response(patched, { headers: cached.headers });
          }
          return cached;
        })
    );
    return;
  }

  event.respondWith(caches.match(request).then((cachedResponse) => cachedResponse || fetch(request)));
});
