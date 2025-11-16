// sw.js - Service Worker with Advanced Caching Strategy
const VERSION = '2.0.0';
const CACHE_STATIC = `samaki-static-v${VERSION}`;
const CACHE_DYNAMIC = `samaki-dynamic-v${VERSION}`;
const CACHE_API = `samaki-api-v${VERSION}`;

// Static assets to cache immediately
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/tracking.html',
    '/manifest.json',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Battambang:wght@300;400;600;700&family=Moul&display=swap'
];

// Cache expiration times
const CACHE_EXPIRY = {
    static: 7 * 24 * 60 * 60 * 1000, // 7 days
    dynamic: 24 * 60 * 60 * 1000,    // 1 day
    api: 5 * 60 * 1000                // 5 minutes
};

// ==================== INSTALL ====================
self.addEventListener('install', (event) => {
    console.log(`🔧 [SW v${VERSION}] Installing...`);
    
    event.waitUntil(
        caches.open(CACHE_STATIC)
            .then(cache => {
                console.log('📦 Caching static assets');
                return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
            })
            .catch(err => {
                console.error('❌ Failed to cache:', err);
            })
            .then(() => {
                console.log('✅ Installation complete');
                return self.skipWaiting();
            })
    );
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', (event) => {
    console.log(`🚀 [SW v${VERSION}] Activating...`);
    
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(name => {
                            return name.startsWith('samaki-') && 
                                   !name.includes(VERSION);
                        })
                        .map(name => {
                            console.log(`🗑️ Deleting old cache: ${name}`);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('✅ Activation complete');
                return self.clients.claim();
            })
    );
});

// ==================== FETCH ====================
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip cross-origin requests except for specific CDNs
    if (url.origin !== self.location.origin && 
        !url.hostname.includes('cdn.jsdelivr.net') &&
        !url.hostname.includes('cdnjs.cloudflare.com') &&
        !url.hostname.includes('fonts.googleapis.com') &&
        !url.hostname.includes('fonts.gstatic.com')) {
        return;
    }

    // API requests: Network-first with cache fallback
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(handleAPIRequest(request));
        return;
    }

    // Static assets: Cache-first
    if (isStaticAsset(url)) {
        event.respondWith(handleStaticRequest(request));
        return;
    }

    // HTML pages: Network-first with cache fallback
    if (request.destination === 'document') {
        event.respondWith(handleDocumentRequest(request));
        return;
    }

    // Other resources: Cache-first with network fallback
    event.respondWith(handleDynamicRequest(request));
});

// ==================== REQUEST HANDLERS ====================

// API: Network-first with short cache
async function handleAPIRequest(request) {
    const cache = await caches.open(CACHE_API);
    
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            await cache.put(request, responseToCache);
        }
        
        return networkResponse;
    } catch (error) {
        console.log('📡 Network failed, trying cache for:', request.url);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            // Add header to indicate cached response
            const newHeaders = new Headers(cachedResponse.headers);
            newHeaders.set('X-Cached', 'true');
            
            return new Response(cachedResponse.body, {
                status: cachedResponse.status,
                statusText: cachedResponse.statusText,
                headers: newHeaders
            });
        }
        
        return new Response(
            JSON.stringify({ 
                error: 'អ៊ីនធឺណិតមានបញ្ហា',
                offline: true,
                cached: false
            }),
            {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}

// Static: Cache-first with network update
async function handleStaticRequest(request) {
    const cache = await caches.open(CACHE_STATIC);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
        // Update cache in background
        fetch(request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
                cache.put(request, networkResponse.clone());
            }
        }).catch(() => {});
        
        return cachedResponse;
    }
    
    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
            await cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (error) {
        return new Response('Offline', { status: 503 });
    }
}

// Documents: Network-first with cache fallback
async function handleDocumentRequest(request) {
    const cache = await caches.open(CACHE_DYNAMIC);
    
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse && networkResponse.status === 200) {
            await cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Return offline page
        return cache.match('/index.html');
    }
}

// Dynamic: Cache-first with network fallback
async function handleDynamicRequest(request) {
    const cache = await caches.open(CACHE_DYNAMIC);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
        // Refresh cache in background
        fetch(request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
                cache.put(request, networkResponse.clone());
            }
        }).catch(() => {});
        
        return cachedResponse;
    }
    
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse && networkResponse.status === 200) {
            await cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        return new Response('Resource unavailable offline', { status: 503 });
    }
}

// ==================== HELPERS ====================

function isStaticAsset(url) {
    const staticExtensions = ['.css', '.js', '.woff', '.woff2', '.ttf', '.svg', '.png', '.jpg', '.jpeg', '.gif'];
    const staticHosts = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
    
    return staticExtensions.some(ext => url.pathname.endsWith(ext)) ||
           staticHosts.some(host => url.hostname.includes(host));
}

// ==================== MESSAGE HANDLING ====================
self.addEventListener('message', (event) => {
    console.log('💬 Message received:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(name => caches.delete(name))
                );
            }).then(() => {
                console.log('🗑️ All caches cleared');
            })
        );
    }
    
    if (event.data && event.data.type === 'GET_VERSION') {
        event.ports[0].postMessage({ version: VERSION });
    }
});

// ==================== BACKGROUND SYNC ====================
self.addEventListener('sync', (event) => {
    console.log('🔄 Background sync:', event.tag);
    
    if (event.tag === 'sync-data') {
        event.waitUntil(syncData());
    }
});

async function syncData() {
    // Implement background sync logic here
    console.log('🔄 Syncing data...');
    return Promise.resolve();
}

// ==================== PUSH NOTIFICATIONS ====================
self.addEventListener('push', (event) => {
    console.log('🔔 Push notification received');
    
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'អនុវិទ្យាល័យសាមគ្គី';
    const options = {
        body: data.body || 'មានការជូនដំណឹងថ្មី',
        icon: 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Emblem_of_the_Ministry_of_Education%2C_Youth_and_Sport_%28Cambodia%29.svg',
        badge: 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Emblem_of_the_Ministry_of_Education%2C_Youth_and_Sport_%28Cambodia%29.svg',
        vibrate: [200, 100, 200],
        tag: data.tag || 'samaki-notification',
        requireInteraction: false,
        data: {
            url: data.url || '/',
            timestamp: Date.now()
        }
    };
    
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', (event) => {
    console.log('🖱️ Notification clicked');
    
    event.notification.close();
    
    event.waitUntil(
        clients.openWindow(event.notification.data?.url || '/')
    );
});

// ==================== CACHE CLEANUP ====================
// Clean old cache entries periodically
async function cleanupOldCaches() {
    const caches_list = await caches.keys();
    
    for (const cacheName of caches_list) {
        if (cacheName.startsWith('samaki-')) {
            const cache = await caches.open(cacheName);
            const requests = await cache.keys();
            
            for (const request of requests) {
                const response = await cache.match(request);
                const cacheDate = new Date(response.headers.get('date'));
                const now = new Date();
                const age = now - cacheDate;
                
                let maxAge = CACHE_EXPIRY.dynamic;
                if (cacheName.includes('static')) maxAge = CACHE_EXPIRY.static;
                if (cacheName.includes('api')) maxAge = CACHE_EXPIRY.api;
                
                if (age > maxAge) {
                    console.log('🗑️ Removing expired cache:', request.url);
                    await cache.delete(request);
                }
            }
        }
    }
}

// Run cleanup on activation and periodically
self.addEventListener('activate', (event) => {
    event.waitUntil(cleanupOldCaches());
});

console.log(`✅ [SW v${VERSION}] Service Worker loaded successfully!`);