// A fresh page load gets the latest shell online; an open player stays unchanged.
// No polling, forced activation, or automatic reloads. HTML edits need no version bump.
// VERSION changes only when the worker/cache format itself changes.
const VERSION = 'v8';
const PREFIX = `fc-archive-${new URL(self.registration.scope).pathname}-`;
const SHELL = `${PREFIX}shell-${VERSION}`;
const METADATA = `${PREFIX}metadata-v1`;
const ASSETS = ['index.html', 'album.html', 'manifest.webmanifest'];
const scoped = path => new URL(path, self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(ASSETS.map(async path => {
      const response = await fetch(scoped(path), {cache:'no-store'});
      if (!response.ok) throw new Error(`Could not cache ${path}`);
      await cache.put(scoped(path), response);
    }));
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== SHELL && name !== METADATA) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
async function freshShell(request, path) {
  const cache = await caches.open(SHELL);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(request, {cache:'no-store', signal:controller.signal});
    if (!response.ok) throw new Error('Shell unavailable');
    // Query strings select app views, not separate versions of the static shell.
    await cache.put(scoped(path), response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(scoped(path));
    if (cached) return cached;
    throw error;
  } finally { clearTimeout(timeout); }
}
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Audio, including the in-memory seek fallback, is never cached here.
  if (request.headers.has('range') || url.pathname.startsWith('/download/')) return;
  if (url.origin === self.location.origin && url.href.startsWith(self.registration.scope)) {
    const relative = url.pathname.slice(new URL(self.registration.scope).pathname.length);
    if (relative === '' && request.mode === 'navigate') event.respondWith(freshShell(request, 'index.html'));
    else if (ASSETS.includes(relative)) event.respondWith(freshShell(request, relative));
  } else if (url.origin === 'https://archive.org' && url.pathname.startsWith('/metadata/')) {
    event.respondWith((async () => {
      const cache = await caches.open(METADATA);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(request, {signal:controller.signal});
        if (!response.ok) throw new Error('Metadata unavailable');
        await cache.put(request, response.clone());
        const entries = await cache.keys();
        if (entries.length > 100) await cache.delete(entries[0]);
        return response;
      } catch {
        return await cache.match(request) || new Response(JSON.stringify({error:'Offline: this album has not been cached yet.'}), {status:503,headers:{'Content-Type':'application/json'}});
      } finally { clearTimeout(timeout); }
    })());
  }
});
