import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { ROOT } from '../db.js';
import { HttpError } from './http.js';

const UPLOAD_DIR = join(ROOT, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Grava um data URL (base64) enviado pelo navegador e devolve o caminho publico.
 * O front ja reduz a imagem antes do envio; aqui apenas validamos e persistimos.
 */
export async function saveImage(dataUrl, prefix = 'arquivo') {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  if (dataUrl.startsWith('/uploads/')) return dataUrl;              // ja salvo
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!m) throw new HttpError(400, 'Formato de arquivo invalido');
  const [, mime, b64] = m;
  const ext = EXT[mime];
  if (!ext) throw new HttpError(400, 'Envie uma imagem JPG, PNG, WEBP ou um PDF');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'Arquivo maior que 8MB. Tire a foto com resolucao menor.');
  const name = `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;
  writeFileSync(join(UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}
