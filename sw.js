const VERSION='forme-shell-v1';
self.addEventListener('install',ev=>{ev.waitUntil(caches.open(VERSION).then(c=>c.addAll(['/','/manifest.webmanifest'])));self.skipWaiting()});
self.addEventListener('activate',ev=>{ev.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',ev=>{
  const u=new URL(ev.request.url);
  if(ev.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/')||u.pathname.startsWith('/auth/'))return;
  if(ev.request.mode==='navigate') ev.respondWith(fetch(ev.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(VERSION).then(c=>c.put('/',copy))}return r}).catch(()=>caches.match('/')));
});
