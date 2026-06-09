/* 简易 Service Worker：缓存应用外壳，让 PWA 可安装/离线打开界面。
 * 模型文件在远程 CDN（跨域），始终走网络。 */
const CACHE = 'ar-app-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 仅缓存同源应用外壳；跨域(模型 CDN / model-viewer 库)直接走网络
  if (url.origin === location.origin) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});
