import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { db, ROOT } from './db.js';
import { seedIfEmpty } from './seed.js';
import { userFromToken } from './lib/auth.js';
import { json, readBody, parseCookies, HttpError } from './lib/http.js';

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import productRoutes from './routes/products.js';
import stockRoutes from './routes/stock.js';
import customerRoutes from './routes/customers.js';
import salesRoutes from './routes/sales.js';
import financeRoutes from './routes/finance.js';
import statsRoutes from './routes/stats.js';
import campaignRoutes from './routes/campaigns.js';
import catalogRoutes from './routes/catalog.js';
import aiRoutes from './routes/ai.js';
import notificationRoutes from './routes/notifications.js';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = join(ROOT, 'public');
const UPLOAD_DIR = join(ROOT, 'uploads');

if (seedIfEmpty()) console.log('> Banco inicializado com lojas, usuarios e produtos padrao.');

/* ---------------- Rotas ---------------- */
const ROUTES = Object.assign({}, authRoutes, adminRoutes, productRoutes, stockRoutes,
  customerRoutes, salesRoutes, financeRoutes, statsRoutes, campaignRoutes, catalogRoutes,
  aiRoutes, notificationRoutes);

/** Rotas que nao exigem sessao. */
const PUBLIC_ROUTES = new Set([
  'POST /api/auth/login', 'POST /api/auth/logout', 'GET /api/auth/me',
  'GET /api/catalogo', 'GET /api/catalogo/lojas'
]);

const compiled = Object.entries(ROUTES).map(([key, handler]) => {
  const [method, pattern] = key.split(' ');
  const names = [];
  const regex = new RegExp('^' + pattern.replace(/:[A-Za-z_]+/g, (m) => {
    names.push(m.slice(1)); return '([^/]+)';
  }).replace(/\//g, '\\/') + '$');
  return { key, method, regex, names, handler };
});

function matchRoute(method, pathname) {
  for (const r of compiled) {
    if (r.method !== method) continue;
    const m = r.regex.exec(pathname);
    if (!m) continue;
    const params = {};
    r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
    return { ...r, params };
  }
  return null;
}

/* ---------------- Estaticos ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

async function serveFile(res, baseDir, relPath, { cache = false } = {}) {
  const safe = normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const file = join(baseDir, safe);
  if (!file.startsWith(baseDir)) { res.writeHead(403).end('Proibido'); return true; }
  try {
    const st = await stat(file);
    if (!st.isFile()) return false;
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': cache ? 'public, max-age=86400' : 'no-cache'
    });
    res.end(data);
    return true;
  } catch { return false; }
}

/* ---------------- Servidor ---------------- */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  // Comprovantes de pagamento e imagens enviadas
  if (pathname.startsWith('/uploads/')) {
    const served = await serveFile(res, UPLOAD_DIR, pathname.slice('/uploads/'.length), { cache: true });
    if (!served) json(res, 404, { error: 'Arquivo nao encontrado' });
    return;
  }

  if (pathname.startsWith('/api/')) {
    const route = matchRoute(req.method, pathname);
    if (!route) return json(res, 404, { error: 'Rota nao encontrada' });

    const cookies = parseCookies(req);
    const token = cookies.erp_session || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = userFromToken(token);

    if (!PUBLIC_ROUTES.has(route.key) && !user) return json(res, 401, { error: 'Sessao expirada. Faca login novamente.' });

    let body = {};
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      try { body = await readBody(req); }
      catch (e) { return json(res, e.status || 400, { error: e.message }); }
    }

    const ctx = {
      req, res, url, token, user, body, params: route.params,
      query: Object.fromEntries(url.searchParams.entries()),
      setCookie(name, value, expires) {
        const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
          `Expires=${new Date(expires).toUTCString()}`];
        if (process.env.SECURE_COOKIE === '1') parts.push('Secure');
        res.setHeader('Set-Cookie', parts.join('; '));
      }
    };

    try {
      await route.handler(ctx);
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.status, { error: e.message });
      console.error('[erro]', route.key, e);
      if (!res.headersSent) json(res, 500, { error: 'Erro interno no servidor' });
    }
    return;
  }

  // Aplicativo de loja unica (PWA instalavel no celular).
  // A barra final e obrigatoria: sem ela os caminhos relativos do app
  // (css/, js/, sw.js) resolveriam para a raiz do sistema principal.
  if (pathname === '/loja') {
    res.writeHead(301, { Location: '/loja/' + url.search });
    res.end();
    return;
  }
  if (pathname === '/loja/') {
    if (await serveFile(res, PUBLIC_DIR, 'loja/index.html')) return;
  }

  // SPA + catalogo publico
  if (pathname === '/' || pathname === '/index.html') {
    if (await serveFile(res, PUBLIC_DIR, 'index.html')) return;
  }
  if (pathname === '/catalogo') {
    if (await serveFile(res, PUBLIC_DIR, 'catalogo.html')) return;
  }
  if (await serveFile(res, PUBLIC_DIR, pathname.replace(/^\//, ''), { cache: pathname.startsWith('/img/') })) return;

  // cada aplicativo cai no seu proprio index, nunca no do outro
  const inicial = pathname.startsWith('/loja/') ? 'loja/index.html' : 'index.html';
  if (await serveFile(res, PUBLIC_DIR, inicial)) return;
  json(res, 404, { error: 'Nao encontrado' });
});

server.listen(PORT, () => {
  const n = db.prepare('SELECT COUNT(*) n FROM products').get().n;
  console.log(`\n  Loja das Argamassas ERP`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Catalogo publico: http://localhost:${PORT}/catalogo`);
  console.log(`  ${n} produtos cadastrados\n`);
});

process.on('SIGINT', () => { db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });
