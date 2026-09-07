import { db } from '../db.js';
import { resolveStoreFilter } from '../lib/auth.js';
import { ok, str } from '../lib/http.js';
import { sweepLowStock } from '../lib/notify.js';
import { ativarCampanhasVencidas } from './campaigns.js';

export default {
  'GET /api/notificacoes': async (ctx) => {
    try { sweepLowStock(); ativarCampanhasVencidas(); } catch {}
    const somenteNaoLidas = ctx.query.nao_lidas === '1';
    const rows = db.prepare(`
      SELECT n.*, s.name AS store_name FROM notifications n
        LEFT JOIN stores s ON s.id = n.store_id
       WHERE n.user_id = ? ${somenteNaoLidas ? 'AND n.read_at IS NULL' : ''}
       ORDER BY n.id DESC LIMIT 100`).all(ctx.user.id);
    const naoLidas = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(ctx.user.id).n;
    return ok(ctx.res, { notificacoes: rows, nao_lidas: naoLidas });
  },

  'POST /api/notificacoes/ler': async (ctx) => {
    if (ctx.body.id) db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?").run(Number(ctx.body.id), ctx.user.id);
    else db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(ctx.user.id);
    return ok(ctx.res);
  }
};
