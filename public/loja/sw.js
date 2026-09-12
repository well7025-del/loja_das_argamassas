/* Service worker: guarda o aplicativo no celular para abrir sem internet.
   Estratégia: o app é servido do cache (rápido e offline) e atualizado em
   segundo plano. Nada de dado da loja passa por aqui — isso vive no IndexedDB. */
const CACHE = 'loja-caruaru-v2';
const ARQUIVOS = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css',
  './js/app.js', './js/db.js', './js/ui.js', './js/voice.js', './js/backup.js',
  './js/impressora.js',
  './js/views/inicio.js', './js/views/pdv.js', './js/views/estoque.js',
  './js/views/contas.js', './js/views/mais.js', './js/views/clientes.js',
  './js/views/despesas.js', './js/views/relatorio.js', './js/views/ajustes.js',
  './js/views/vendas.js',
  './icons/icone-192.png', './icons/icone-512.png', './icons/icone-mascara.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ARQUIVOS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(nomes.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Chamadas ao Google (autorização e Drive) nunca são servidas do cache.
  if (url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('google.com')) return;
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then(guardado => {
      const rede = fetch(e.request).then(resposta => {
        if (resposta.ok) caches.open(CACHE).then(c => c.put(e.request, resposta.clone()));
        return resposta;
      }).catch(() => guardado || caches.match('./index.html'));
      return guardado || rede;
    })
  );
});

self.addEventListener('message', (e) => { if (e.data === 'atualizar') self.skipWaiting(); });
