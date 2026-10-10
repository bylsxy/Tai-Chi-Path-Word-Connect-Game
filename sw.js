const CACHE_NAME = 'taichi-game-v2-logic-1'; // 更新资源缓存，避免仍加载修复前的脚本和样式。
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './grid-worker.js',
  './manifest.json',
  './icon.png'
];

// 安装时预缓存所有资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()) // 跳过等待，立即激活新 SW
  );
});

// 激活时清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim()) // 立即接管所有页面
  );
});

// 缓存优先策略
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
