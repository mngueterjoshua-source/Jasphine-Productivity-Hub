/* ============================================================
   JASPHINE INTERNATIONAL — SERVICE WORKER v5.0
   FILE: sw.js  |  Replace existing sw.js entirely
   
   Architecture: Network-First for all live GAS data,
   Cache-First for static shell assets.
   Push-capable: handles Web Push events from relay backend.
   ============================================================ */

'use strict';

var CACHE_NAME      = 'jasphine-hub-shell-v5';
var CACHE_ASSETS    = [
  '/',
  '/index.html'
  // Add any locally hosted static assets here.
  // Do NOT cache GAS Web App URLs — always network-fetch those.
];

var GAS_URL_PATTERNS = [
  'script.google.com',
  'script.googleusercontent.com'
];

// ─── INSTALL ─────────────────────────────────────────────────────────────────

self.addEventListener('install', function(event) {
  console.log('[JI SW] Installing v5.0...');
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CACHE_ASSETS).catch(function(err) {
        // Non-fatal: shell cache failure should not block activation
        console.warn('[JI SW] Shell cache partial failure:', err.message);
      });
    })
  );
});

// ─── ACTIVATE ────────────────────────────────────────────────────────────────

self.addEventListener('activate', function(event) {
  console.log('[JI SW] Activating v5.0...');
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ─── FETCH — Network-First for GAS, Cache-First for shell ────────────────────

self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // Always network-first for GAS endpoints
  var isGAS = GAS_URL_PATTERNS.some(function(p) { return url.indexOf(p) !== -1; });
  if (isGAS || event.request.method !== 'GET') {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(
          JSON.stringify({ error: 'Offline — GAS endpoint unreachable.' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // Shell assets: cache-first, network fallback
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        // Cache valid same-origin responses
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(c) { c.put(event.request, clone); });
        }
        return response;
      }).catch(function() {
        // Offline fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ─── PUSH EVENT — Incoming Web Push from relay backend ───────────────────────
// GAS triggers a push relay (Cloud Function or similar) which calls the
// Push API endpoint. The SW receives the raw push event here.

self.addEventListener('push', function(event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch(e) {
    data = { title: event.data ? event.data.text() : 'Jasphine Alert', body: '' };
  }

  var title   = data.title   || 'Jasphine Command Centre';
  var body    = data.body    || '';
  var tag     = data.tag     || 'ji-push-' + Date.now();
  var urgency = data.urgency || 'normal'; // 'critical' | 'high' | 'normal' | 'low'

  var iconMap = {
    critical: '/icons/icon-critical.png',
    high:     '/icons/icon-high.png',
    normal:   '/icons/icon-192.png',
    low:      '/icons/icon-192.png'
  };

  var options = {
    body:              body,
    icon:              iconMap[urgency] || '/icons/icon-192.png',
    badge:             '/icons/badge-72.png',
    tag:               tag,
    renotify:          urgency === 'critical',
    requireInteraction: urgency === 'critical',
    silent:            urgency === 'low',
    data:              data,
    actions: urgency === 'critical' ? [
      { action: 'open',    title: 'Open Centre' },
      { action: 'dismiss', title: 'Dismiss' }
    ] : []
  };

  event.waitUntil(
    self.registration.showNotification(title, options).then(function() {
      // Relay the push to any open clients (for in-app notification drawer)
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    }).then(function(clients) {
      clients.forEach(function(client) {
        client.postMessage({
          type:     'JI_PUSH',
          title:    title,
          body:     body,
          dotClass: urgency === 'critical' ? 'red' : urgency === 'high' ? 'amber' : 'green'
        });
      });
    })
  );
});

// ─── NOTIFICATION CLICK ───────────────────────────────────────────────────────

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  if (event.action === 'dismiss') return;

  var targetUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      // Focus existing window if open
      for (var i = 0; i < clients.length; i++) {
        var client = clients[i];
        if (client.url.indexOf(self.location.origin) !== -1 && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// ─── MESSAGE HANDLER — Show notification on demand from page ─────────────────
// Called by mobile JS via: navigator.serviceWorker.controller.postMessage(...)

self.addEventListener('message', function(event) {
  if (!event.data) return;

  if (event.data.type === 'JI_SHOW_NOTIF') {
    var opts = {
      body:    event.data.body  || '',
      icon:    event.data.icon  || '/icons/icon-192.png',
      badge:   '/icons/badge-72.png',
      tag:     event.data.tag   || 'ji-task-' + Date.now(),
      silent:  false,
      requireInteraction: false
    };
    self.registration.showNotification(event.data.title || 'Jasphine Alert', opts);
  }

  if (event.data.type === 'JI_SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─── PUSH SUBSCRIPTION CHANGE ────────────────────────────────────────────────

self.addEventListener('pushsubscriptionchange', function(event) {
  // Subscription expired or was refreshed by browser
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: event.oldSubscription ? event.oldSubscription.options.applicationServerKey : null
    }).then(function(subscription) {
      // Notify all clients to re-register the new subscription
      return self.clients.matchAll({ type: 'window' }).then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({
            type:         'JI_PUSH_RESUBSCRIBED',
            subscription: JSON.stringify(subscription)
          });
        });
      });
    }).catch(function(err) {
      console.error('[JI SW] pushsubscriptionchange re-subscribe failed:', err.message);
    })
  );
});
