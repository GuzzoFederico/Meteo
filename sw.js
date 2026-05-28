// https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers

const urlsToCache = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json', '/meteo.svg'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open('meteo').then(cache => cache.addAll(urlsToCache)));
});

self.addEventListener('fetch', event => {
    event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)));
});