/**
 * Service Worker מינימלי — נדרש כדי שכרום יציע "התקן אפליקציה".
 *
 * אסטרטגיה: network-first (רשת תחילה) בלי precache. האתר מתעדכן תכופות,
 * ו-SW ששומר במטמון אגרסיבי היה מגיש גרסה ישנה אחרי פריסה. כאן פשוט
 * מעבירים כל בקשה לרשת; אם אין רשת, מנסים מטמון (למקרה שנאגר בעבר).
 */
const CACHE = "nadlan360-runtime";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // שומרים עותק רק לניווטים ולנכסים, לגיבוי אופליין.
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request)),
  );
});
