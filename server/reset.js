import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
for (const f of ['erp.db', 'erp.db-wal', 'erp.db-shm']) {
  try { rmSync(join(dir, f)); } catch {}
}
console.log('Banco removido. Rode "npm start" para recriar com os dados iniciais.');
