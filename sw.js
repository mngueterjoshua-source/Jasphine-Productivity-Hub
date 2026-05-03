const CACHE_NAME = 'jasphine-hub-core-v1';

// Install Event: Forces immediate activation of the Service Worker
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Activate Event: Claims the active clients
self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// Fetch Event: Network-first passthrough to ensure live Apps Script data is always fetched
self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
