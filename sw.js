/* 空位监控 · Service Worker
   目的：让「添加到主屏幕」后的 app 能离线打开，并保证改版后不会吃到旧缓存。

   策略（刻意选最保守的一种）：
   - 只处理同源 GET：空位查询是浏览器直连上游 issks 接口（跨源），
     这些请求在这一行就被放过，绝不进缓存 —— 缓存住只会显示过期的空位数；
   - 校园瓦片、样式表、精灵图、字形都是跨源的（gis.uestc.edu.cn），同样在这一行被放过
     （离线时地图自然只剩底色，属预期 —— 地图数据本来就没法离线）；
   - 其余请求「网络优先，失败回退缓存」：在线时每次拿到的都是最新文件（不会出现
     改了页面却看到旧版的情况），只有真离线才用缓存兜底。
*/
const CACHE = "kongwei-jiankong-v2";

const CORE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./vendor/fonts.css",
  "./vendor/tailwind-browser.js",
  "./vendor/fonts/unbounded-latin.woff2",
  "./vendor/fonts/unbounded-latin-ext.woff2",
  // 地图渲染器（MapLibre）：本地化资源，离线也要能开（瓦片本身跨源，不在此列）
  "./vendor/maplibre/maplibre-gl.js",
  "./vendor/maplibre/maplibre-gl.css",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

/* 逐个 add 而不是 addAll：只要有一个 URL 404（比如某个环境没有把 / 映射到 index.html），
   addAll 会整体 reject，导致 SW 根本装不上，后续所有离线能力一起失效。 */
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(CORE.map((u) =>
      cache.add(new Request(u, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;
  // 同源接口不进缓存（本应用目前没有这类请求，守住这条线，避免以后误缓存实时数据）
  if (url.pathname.includes("/api/")) return;

  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      // 只缓存成功的完整响应（206/opaque 之类存了反而会污染）
      if (res && res.status === 200 && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (_) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      // 导航请求离线兜底：任意页面路径都回首页外壳，交给前端 hash 路由
      if (req.mode === "navigate") {
        return (await caches.match("./index.html")) ||
               (await caches.match("./")) ||
               Response.error();
      }
      return Response.error();
    }
  })());
});
