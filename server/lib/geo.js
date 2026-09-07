/**
 * Geolocalizacao aproximada de clientes a partir do CEP.
 *
 * Estrategia em camadas:
 *  1. cache local (tabela cep_cache)
 *  2. consulta online (ViaCEP para endereco + Nominatim/OSM para coordenada) — se houver internet
 *  3. tabela de faixas de CEP embarcada -> centroide da cidade/regiao (sempre funciona offline)
 *
 * A precisao e sempre devolvida junto ao resultado para que o mapa possa ser honesto
 * sobre o que esta mostrando.
 */
import { db } from '../db.js';

/** [inicioCEP5, fimCEP5, rotulo, uf, lat, lng] */
const FAIXAS = [
  // --- Recife (detalhado por zona) ---
  [50000, 50199, 'Recife - Centro/Boa Vista', 'PE', -8.0632, -34.8780],
  [50200, 50399, 'Recife - Espinheiro/Gracas', 'PE', -8.0370, -34.8970],
  [50400, 50599, 'Recife - Madalena/Afogados', 'PE', -8.0630, -34.9130],
  [50600, 50799, 'Recife - Torre/Cordeiro', 'PE', -8.0450, -34.9160],
  [50800, 50999, 'Recife - Areias/Jiquia', 'PE', -8.0880, -34.9290],
  [51000, 51299, 'Recife - Boa Viagem/Pina', 'PE', -8.1200, -34.9020],
  [51300, 51999, 'Recife - Ibura/Jordao', 'PE', -8.1300, -34.9400],
  [52000, 52199, 'Recife - Casa Amarela', 'PE', -8.0230, -34.9060],
  [52200, 52399, 'Recife - Casa Forte/Monteiro', 'PE', -8.0300, -34.9180],
  [52400, 52999, 'Recife - Varzea/Iputinga', 'PE', -8.0480, -34.9510],
  // --- Regiao metropolitana ---
  [53000, 53399, 'Olinda', 'PE', -7.9960, -34.8550],
  [53400, 53499, 'Paulista', 'PE', -7.9400, -34.8730],
  [53500, 53699, 'Igarassu/Abreu e Lima', 'PE', -7.8340, -34.9060],
  [53700, 53999, 'Itapissuma/Itamaraca', 'PE', -7.7770, -34.8930],
  [54000, 54499, 'Jaboatao dos Guararapes', 'PE', -8.1130, -35.0150],
  [54500, 54599, 'Cabo de Santo Agostinho', 'PE', -8.2880, -35.0340],
  [54600, 54699, 'Moreno', 'PE', -8.1190, -35.0920],
  [54700, 54999, 'Sao Lourenco da Mata/Camaragibe', 'PE', -8.0020, -35.0180],
  // --- Agreste e interior de PE ---
  [55000, 55049, 'Caruaru - Centro', 'PE', -8.2840, -35.9700],
  [55050, 55099, 'Caruaru - Bairros', 'PE', -8.3010, -35.9900],
  [55100, 55199, 'Bezerros/Gravata', 'PE', -8.2340, -35.7960],
  [55200, 55299, 'Belo Jardim/Pesqueira', 'PE', -8.3360, -36.4240],
  [55300, 55499, 'Garanhuns', 'PE', -8.8900, -36.4970],
  [55500, 55599, 'Bom Conselho/Agreste Sul', 'PE', -9.1690, -36.6790],
  [55600, 55699, 'Vitoria de Santo Antao', 'PE', -8.1180, -35.2910],
  [55700, 55799, 'Limoeiro/Surubim', 'PE', -7.8740, -35.4470],
  [55800, 55999, 'Palmares/Zona da Mata Sul', 'PE', -8.6830, -35.5900],
  [56000, 56199, 'Serra Talhada/Sertao', 'PE', -7.9850, -38.2980],
  [56200, 56299, 'Salgueiro', 'PE', -8.0740, -39.1240],
  [56300, 56399, 'Petrolina', 'PE', -9.3890, -40.5020],
  [56400, 56999, 'Arcoverde/Sertao', 'PE', -8.4190, -37.0560],
  // --- Demais estados (centroides de capital/regiao) ---
  [1000, 5999, 'Sao Paulo - Capital', 'SP', -23.5505, -46.6333],
  [6000, 9999, 'Grande Sao Paulo', 'SP', -23.5330, -46.7920],
  [10000, 19999, 'Interior de Sao Paulo', 'SP', -22.9050, -47.0610],
  [20000, 23799, 'Rio de Janeiro - Capital', 'RJ', -22.9068, -43.1729],
  [24000, 28999, 'Interior do Rio de Janeiro', 'RJ', -22.8830, -43.1040],
  [29000, 29999, 'Espirito Santo', 'ES', -20.3155, -40.3128],
  [30000, 31999, 'Belo Horizonte', 'MG', -19.9167, -43.9345],
  [32000, 39999, 'Interior de Minas Gerais', 'MG', -19.4690, -44.2470],
  [40000, 42599, 'Salvador', 'BA', -12.9777, -38.5016],
  [42600, 48999, 'Interior da Bahia', 'BA', -12.2600, -41.0000],
  [49000, 49999, 'Sergipe', 'SE', -10.9472, -37.0731],
  [57000, 57999, 'Alagoas', 'AL', -9.6658, -35.7353],
  [58000, 58099, 'Joao Pessoa', 'PB', -7.1195, -34.8450],
  [58100, 58999, 'Interior da Paraiba', 'PB', -7.2300, -35.8810],
  [59000, 59139, 'Natal', 'RN', -5.7945, -35.2110],
  [59140, 59999, 'Interior do Rio Grande do Norte', 'RN', -5.9000, -37.3400],
  [60000, 61999, 'Fortaleza', 'CE', -3.7319, -38.5267],
  [62000, 63999, 'Interior do Ceara', 'CE', -4.9700, -39.0200],
  [64000, 64999, 'Piaui', 'PI', -5.0892, -42.8019],
  [65000, 65999, 'Maranhao', 'MA', -2.5297, -44.3028],
  [66000, 67999, 'Belem', 'PA', -1.4558, -48.5039],
  [68000, 68899, 'Interior do Para/Amapa', 'PA', -2.4400, -54.7000],
  [68900, 68999, 'Amapa', 'AP', 0.0349, -51.0694],
  [69000, 69299, 'Manaus', 'AM', -3.1190, -60.0217],
  [69300, 69399, 'Roraima', 'RR', 2.8235, -60.6758],
  [69400, 69899, 'Interior do Amazonas', 'AM', -3.4700, -62.2100],
  [69900, 69999, 'Acre', 'AC', -9.9747, -67.8100],
  [70000, 72799, 'Brasilia', 'DF', -15.7939, -47.8828],
  [72800, 73999, 'Entorno do DF', 'GO', -16.0000, -48.0000],
  [74000, 76799, 'Goias', 'GO', -16.6869, -49.2648],
  [76800, 76999, 'Rondonia', 'RO', -8.7619, -63.9039],
  [77000, 77999, 'Tocantins', 'TO', -10.1849, -48.3336],
  [78000, 78899, 'Mato Grosso', 'MT', -15.6014, -56.0979],
  [79000, 79999, 'Mato Grosso do Sul', 'MS', -20.4697, -54.6201],
  [80000, 82999, 'Curitiba', 'PR', -25.4284, -49.2733],
  [83000, 87999, 'Interior do Parana', 'PR', -24.9550, -53.4550],
  [88000, 88499, 'Florianopolis', 'SC', -27.5954, -48.5480],
  [88500, 89999, 'Interior de Santa Catarina', 'SC', -27.1000, -50.0000],
  [90000, 91999, 'Porto Alegre', 'RS', -30.0346, -51.2177],
  [92000, 99999, 'Interior do Rio Grande do Sul', 'RS', -29.6800, -52.4300]
];

export const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');
export const formatCep = (v) => {
  const d = onlyDigits(v).padStart(8, '0').slice(0, 8);
  return `${d.slice(0, 5)}-${d.slice(5)}`;
};
export const isValidCep = (v) => onlyDigits(v).length === 8;

/** Dispersao deterministica (mesmo CEP -> mesmo ponto) para evitar marcadores empilhados. */
function jitter(cepDigits, lat, lng, radiusKm = 1.2) {
  let h = 2166136261;
  for (const ch of cepDigits) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const a = ((h >>> 0) % 3600) / 3600 * Math.PI * 2;
  const r = (((h >>> 12) % 1000) / 1000) * radiusKm;
  const dLat = (r * Math.cos(a)) / 111;
  const dLng = (r * Math.sin(a)) / (111 * Math.cos(lat * Math.PI / 180) || 1);
  return [lat + dLat, lng + dLng];
}

export function fromRanges(cep) {
  const d = onlyDigits(cep);
  if (d.length !== 8) return null;
  const prefix = Number(d.slice(0, 5));
  const faixa = FAIXAS.find(([ini, fim]) => prefix >= ini && prefix <= fim);
  if (!faixa) return null;
  const [, , label, uf, lat, lng] = faixa;
  const [jLat, jLng] = jitter(d, lat, lng);
  const [cidade, regiao] = label.split(' - ');
  return { city: cidade, district: regiao || '', uf, lat: jLat, lng: jLng, source: 'faixa_cep', precision: 'aproximada' };
}

async function fetchJson(url, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'LojaDasArgamassasERP/1.0', 'Accept': 'application/json' }
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

/** Consulta online opcional: ViaCEP (endereco) + Nominatim (coordenada). */
async function lookupOnline(cepDigits) {
  const via = await fetchJson(`https://viacep.com.br/ws/${cepDigits}/json/`);
  if (!via || via.erro) return null;
  const out = {
    street: via.logradouro || '', district: via.bairro || '',
    city: via.localidade || '', uf: via.uf || '',
    lat: null, lng: null, source: 'viacep', precision: 'bairro'
  };
  const q = encodeURIComponent([via.logradouro, via.bairro, via.localidade, via.uf, 'Brasil'].filter(Boolean).join(', '));
  const geo = await fetchJson(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${q}`);
  if (Array.isArray(geo) && geo[0]) {
    out.lat = Number(geo[0].lat); out.lng = Number(geo[0].lon);
    out.source = 'viacep+osm'; out.precision = 'rua';
  }
  return out;
}

/**
 * Resolve um CEP para endereco + coordenada aproximada.
 * Nunca lanca: sempre devolve algo utilizavel (ou null se o CEP for invalido).
 */
export async function resolveCep(cep, { online = true } = {}) {
  const d = onlyDigits(cep);
  if (d.length !== 8) return null;

  const cached = db.prepare('SELECT * FROM cep_cache WHERE cep = ?').get(d);
  if (cached && cached.lat != null) {
    return {
      cep: formatCep(d), street: cached.street, district: cached.district,
      city: cached.city, uf: cached.uf, lat: cached.lat, lng: cached.lng,
      source: cached.source, precision: cached.source === 'faixa_cep' ? 'aproximada' : 'rua', cached: true
    };
  }

  let result = null;
  if (online) {
    const on = await lookupOnline(d);
    if (on) {
      if (on.lat == null) {
        const fb = fromRanges(d);
        on.lat = fb?.lat ?? null; on.lng = fb?.lng ?? null;
        on.precision = 'aproximada';
      }
      result = on;
    }
  }
  if (!result) {
    const fb = fromRanges(d);
    if (!fb) return null;
    result = { street: '', district: fb.district || '', city: fb.city, uf: fb.uf, lat: fb.lat, lng: fb.lng, source: fb.source, precision: 'aproximada' };
  }

  db.prepare(`INSERT INTO cep_cache(cep,street,district,city,uf,lat,lng,source) VALUES(?,?,?,?,?,?,?,?)
              ON CONFLICT(cep) DO UPDATE SET street=excluded.street, district=excluded.district,
                city=excluded.city, uf=excluded.uf, lat=excluded.lat, lng=excluded.lng, source=excluded.source`)
    .run(d, result.street || '', result.district || '', result.city || '', result.uf || '', result.lat, result.lng, result.source);

  return { cep: formatCep(d), ...result, cached: false };
}

/** Distancia em km entre dois pontos (Haversine). */
export function haversineKm(a, b) {
  const R = 6371, toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
