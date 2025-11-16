// sw.js - Service Worker for PWA
// Version: 1.0.0

const CACHE_NAME = 'samaki-school-v1';
const STATIC_CACHE = 'samaki-static-v1';
const DYNAMIC_CACHE = 'samaki-dynamic-v1';

// 📦 Files to cache immediately on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/tracking.html',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
  'https://fonts.googleapis.com/css2?family=Battambang:wght@100;300;400;700;900&family=Moul&family=Siemreap&display=swap',
  'https://upload.wikimedia.org/wikipedia/commons/4/4a/Emblem_of_the_Ministry_of_Education%2C_Youth_and_Sport_%28Cambodia%29.svg'
];

// 🔧 INSTALL EVENT - Cache static assets
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('📦 Service Worker: Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch(err => {
        console.error('❌ Failed to cache some assets:', err);
      })
      .then(() => {
        console.log('✅ Service Worker: Installation complete');
        return self.skipWaiting(); // Activate immediately
      })
  );
});

// 🚀 ACTIVATE EVENT - Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter(name => name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
            .map(name => {
              console.log('🗑️ Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('✅ Service Worker: Activation complete');
        return self.clients.claim(); // Take control immediately
      })
  );
});

// 🌐 FETCH EVENT - Serve from cache or network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // 🚫 Skip caching for API calls (always fetch fresh)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .catch(() => {
          return new Response(
            JSON.stringify({ 
              error: 'អ៊ីនធឺណិតមានបញ្ហា។ សូមពិនិត្យការតភ្ជាប់របស់អ្នក',
              offline: true 
            }),
            { 
              headers: { 'Content-Type': 'application/json' },
              status: 503
            }
          );
        })
    );
    return;
  }
  
  // 📦 Cache-first strategy for everything else
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          console.log('✅ Serving from cache:', request.url);
          
          // Update cache in background
          fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(DYNAMIC_CACHE).then((cache) => {
                  cache.put(request, networkResponse);
                });
              }
            })
            .catch(() => {});
          
          return cachedResponse;
        }
        
        // Not in cache - fetch from network
        console.log('🌐 Fetching from network:', request.url);
        return fetch(request)
          .then((networkResponse) => {
            if (!networkResponse || networkResponse.status !== 200) {
              return networkResponse;
            }
            
            // Cache the new response
            const responseToCache = networkResponse.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(request, responseToCache);
            });
            
            return networkResponse;
          })
          .catch(() => {
            // Network failed and not in cache
            if (request.destination === 'document') {
              return caches.match('/index.html');
            }
            
            return new Response('Offline - មិនមានអ៊ីនធឺណិត', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'text/plain; charset=utf-8'
              })
            });
          });
      })
  );
});

// 💬 MESSAGE EVENT - Handle messages from the app
self.addEventListener('message', (event) => {
  console.log('💬 Service Worker received message:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('⏩ Skipping waiting...');
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    console.log('🗑️ Clearing all caches...');
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map(name => caches.delete(name))
        );
      })
    );
  }
});

// 🔄 SYNC EVENT - Background sync (future enhancement)
self.addEventListener('sync', (event) => {
  console.log('🔄 Background sync:', event.tag);
  
  if (event.tag === 'sync-attendance') {
    event.waitUntil(
      // Implement background sync logic here if needed
      Promise.resolve()
    );
  }
});

// 🔔 PUSH EVENT - Push notifications (future enhancement)
self.addEventListener('push', (event) => {
  console.log('🔔 Push notification received');
  
  const options = {
    body: event.data ? event.data.text() : 'ការជូនដំណឹងថ្មី',
    icon: 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Emblem_of_the_Ministry_of_Education%2C_Youth_and_Sport_%28Cambodia%29.svg',
    badge: 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Emblem_of_the_Ministry_of_Education%2C_Youth_and_Sport_%28Cambodia%29.svg',
    vibrate: [200, 100, 200],
    tag: 'samaki-notification',
    requireInteraction: false,
    data: {
      url: '/'
    }
  };
  
  event.waitUntil(
    self.registration.showNotification('អនុវិទ្យាល័យសាមគ្គី', options)
  );
});

// 🖱️ NOTIFICATION CLICK - Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('🖱️ Notification clicked');
  
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});

console.log('🎉 Service Worker loaded successfully!');