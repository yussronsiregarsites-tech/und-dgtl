const CACHE_NAME = 'undangan-v2.3';
const ASSETS = [
  '../',
  '../index.html',
  '../manifest.json',
  '../icon-192.png',
  '../icon-512.png',
  '../gold/index.html',
  '../rose/index.html'
];

self.addEventListener('install', e => {
  console.log('[SW] Installing version:', CACHE_NAME);
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(ASSETS))
      .catch(err => console.warn('[SW] Cache failed:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  console.log('[SW] Activating version:', CACHE_NAME);
  e.waitUntil(
    caches.keys().then(keys => 
      Promise.all(
        keys.filter(k => k !== CACHE_NAME)
            .map(k => {
              console.log('[SW] Deleting old cache:', k);
              return caches.delete(k);
            })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  
  // Skip non-GET requests
  if (e.request.method !== 'GET') return;
  
  // API Google Apps Script - Network first (selalu fresh)
  if (url.includes('script.google.com')) {
    e.respondWith(
      fetch(e.request, { mode: 'cors' })
        .then(r => {
          if (r && r.status === 200) {
            const clone = r.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  
  // CDN Resources - Stale while revalidate
  if (url.includes('cdn.tailwindcss.com') || 
      url.includes('unpkg.com') || 
      url.includes('cdnjs.cloudflare.com') ||
      url.includes('fonts.googleapis.com') ||
      url.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(r => {
        return r || fetch(e.request).then(resp => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return resp;
        });
      })
    );
    return;
  }
  
  // Static Assets - Cache first
  e.respondWith(
    caches.match(e.request).then(r => {
      return r || fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => {
        if (e.request.mode === 'navigate') {
          return caches.match('../index.html');
        }
      });
    })
  );
});
