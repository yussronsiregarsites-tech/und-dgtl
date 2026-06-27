// ============================================================
// SERVICE WORKER - Undangan Digital Multi-Klien
// Versi: 2.2
// ============================================================

const CACHE_NAME = 'undangan-v2.2';
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 hari

// Assets yang wajib di-cache saat install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './gold/index.html',
  './rose/index.html'
];

// CDN Resources yang boleh di-cache
const CDN_PATTERNS = [
  'cdn.tailwindcss.com',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// API patterns (jangan cache, selalu fetch terbaru)
const API_PATTERNS = [
  'script.google.com',
  'script.googleusercontent.com'
];

// ============================================================
// INSTALL EVENT - Pre-cache assets penting
// ============================================================
self.addEventListener('install', event => {
  console.log('[SW] Installing version:', CACHE_NAME);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching assets...');
        // Gunakan allSettled agar gagal satu tidak gagal semua
        return Promise.allSettled(
          PRECACHE_ASSETS.map(url => 
            cache.add(url).catch(err => {
              console.warn('[SW] Failed to cache:', url, err.message);
              return null;
            })
          )
        );
      })
      .then(() => {
        console.log('[SW] Pre-caching complete');
        return self.skipWaiting();
      })
      .catch(err => {
        console.warn('[SW] Install error:', err);
      })
  );
});

// ============================================================
// ACTIVATE EVENT - Cleanup cache lama
// ============================================================
self.addEventListener('activate', event => {
  console.log('[SW] Activating version:', CACHE_NAME);
  
  event.waitUntil(
    caches.keys()
      .then(keys => {
        return Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => {
              console.log('[SW] Deleting old cache:', key);
              return caches.delete(key);
            })
        );
      })
      .then(() => {
        console.log('[SW] Activation complete');
        return self.clients.claim();
      })
  );
});

// ============================================================
// FETCH EVENT - Strategy berdasarkan tipe request
// ============================================================
self.addEventListener('fetch', event => {
  const url = event.request.url;
  const request = event.request;
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip chrome-extension and other non-http
  if (!url.startsWith('http')) {
    return;
  }
  
  // 1. API Google Apps Script - Network First (selalu fresh)
  if (isAPIRequest(url)) {
    event.respondWith(handleAPIRequest(request));
    return;
  }
  
  // 2. CDN Resources - Stale While Revalidate (cache dulu, update background)
  if (isCDNRequest(url)) {
    event.respondWith(handleCDNRequest(request));
    return;
  }
  
  // 3. Gambar dari lh3.googleusercontent.com - Cache First (stabil)
  if (isGoogleImage(url)) {
    event.respondWith(handleImageRequest(request));
    return;
  }
  
  // 4. HTML Pages - Network First dengan fallback cache
  if (isHTMLRequest(request)) {
    event.respondWith(handleHTMLRequest(request));
    return;
  }
  
  // 5. Static Assets (CSS, JS, font) - Cache First
  event.respondWith(handleStaticRequest(request));
});

// ============================================================
// HELPER: Cek tipe request
// ============================================================
function isAPIRequest(url) {
  return API_PATTERNS.some(pattern => url.includes(pattern));
}

function isCDNRequest(url) {
  return CDN_PATTERNS.some(pattern => url.includes(pattern));
}

function isGoogleImage(url) {
  return url.includes('lh3.googleusercontent.com') || 
         url.includes('drive.google.com') ||
         url.includes('images.unsplash.com');
}

function isHTMLRequest(request) {
  return request.mode === 'navigate' || 
         request.headers.get('accept')?.includes('text/html');
}

// ============================================================
// STRATEGY 1: API Request - Network First
// Selalu ambil dari server, cache response untuk fallback
// ============================================================
async function handleAPIRequest(request) {
  try {
    const networkResponse = await fetch(request, {
      mode: 'cors',
      credentials: 'omit'
    });
    
    // Cache response jika sukses
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      const responseToCache = networkResponse.clone();
      
      // Cache dengan timestamp untuk expiry
      await cache.put(request, responseToCache);
      
      // Simpan timestamp
      const metaCache = await caches.open(CACHE_NAME + '-meta');
      await metaCache.put(
        new Request(request.url + '-timestamp'),
        new Response(Date.now().toString())
      );
    }
    
    return networkResponse;
  } catch (error) {
    console.warn('[SW] API fetch failed, trying cache:', error.message);
    
    // Fallback ke cache
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return error response jika tidak ada cache
    return new Response(
      JSON.stringify({
        status: 'error',
        message: 'Offline - Tidak dapat terhubung ke server'
      }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// ============================================================
// STRATEGY 2: CDN Request - Stale While Revalidate
// Return cache dulu, update di background
// ============================================================
async function handleCDNRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  // Stale while revalidate
  const fetchPromise = fetch(request)
    .then(networkResponse => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(err => {
      console.warn('[SW] CDN fetch failed:', request.url, err.message);
      if (cachedResponse) return cachedResponse;
      throw err;
    });
  
  return cachedResponse || fetchPromise;
}

// ============================================================
// STRATEGY 3: Image Request - Cache First
// Gambar dari lh3/Drive/Unsplash
// ============================================================
async function handleImageRequest(request) {
  const cache = await caches.open(CACHE_NAME + '-images');
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    // Update cache di background
    fetch(request)
      .then(response => {
        if (response.ok) {
          cache.put(request, response.clone());
        }
      })
      .catch(() => {}); // Silent fail
    
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.warn('[SW] Image fetch failed:', request.url);
    // Return placeholder image jika gagal
    return new Response('', {
      status: 404,
      statusText: 'Image not found'
    });
  }
}

// ============================================================
// STRATEGY 4: HTML Request - Network First dengan fallback
// ============================================================
async function handleHTMLRequest(request) {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.warn('[SW] HTML fetch failed, using cache:', request.url);
    
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Fallback ke index.html untuk navigasi
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    
    return new Response('Offline - Undangan Digital', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// ============================================================
// STRATEGY 5: Static Assets - Cache First
// ============================================================
async function handleStaticRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.warn('[SW] Static fetch failed:', request.url);
    
    // Return 404 jika tidak ada di cache dan tidak bisa fetch
    return new Response('Asset not available offline', {
      status: 404,
      statusText: 'Not Found'
    });
  }
}

// ============================================================
// MESSAGE HANDLER - Untuk komunikasi dengan client
// ============================================================
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Received SKIP_WAITING message');
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    console.log('[SW] Received CLEAR_CACHE message');
    event.waitUntil(
      caches.keys().then(keys => 
        Promise.all(keys.map(key => caches.delete(key)))
      ).then(() => {
        event.ports[0].postMessage({ status: 'cleared' });
      })
    );
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

// ============================================================
// BACKGROUND SYNC (jika didukung)
// ============================================================
self.addEventListener('sync', event => {
  console.log('[SW] Sync event:', event.tag);
  
  if (event.tag === 'sync-rsvp') {
    event.waitUntil(syncPendingRSVP());
  }
});

async function syncPendingRSVP() {
  try {
    // Ambil data RSVP yang pending dari IndexedDB atau localStorage
    // Kirim ke server saat online
    console.log('[SW] Syncing pending RSVP...');
  } catch (error) {
    console.warn('[SW] Sync RSVP failed:', error);
  }
}

// ============================================================
// PERIODIC BACKGROUND SYNC (jika didukung)
// ============================================================
self.addEventListener('periodicsync', event => {
  if (event.tag === 'update-cache') {
    event.waitUntil(updateCriticalAssets());
  }
});

async function updateCriticalAssets() {
  try {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(
      PRECACHE_ASSETS.map(url => 
        fetch(url).then(response => {
          if (response.ok) {
            cache.put(url, response);
          }
        })
      )
    );
    console.log('[SW] Critical assets updated');
  } catch (error) {
    console.warn('[SW] Update critical assets failed:', error);
  }
}

console.log('[SW] Service Worker script loaded - version:', CACHE_NAME);
