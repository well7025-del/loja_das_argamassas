export function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

export const ok = (res, payload = { ok: true }) => json(res, 200, payload);
export const created = (res, payload) => json(res, 201, payload);
export const badRequest = (res, msg = 'Requisicao invalida') => json(res, 400, { error: msg });
export const unauthorized = (res, msg = 'Nao autenticado') => json(res, 401, { error: msg });
export const forbidden = (res, msg = 'Sem permissao para esta acao') => json(res, 403, { error: msg });
export const notFound = (res, msg = 'Nao encontrado') => json(res, 404, { error: msg });

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };

export function readBody(req, limitBytes = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new HttpError(413, 'Arquivo muito grande (limite 25MB)')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, 'JSON invalido')); }
    });
    req.on('error', reject);
  });
}

export function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const num = (v, def = 0) => {
  const n = Number(String(v ?? '').toString().replace(',', '.'));
  return Number.isFinite(n) ? n : def;
};
export const str = (v, def = '') => (v === undefined || v === null ? def : String(v).trim());
export const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';
