/* Utilitarios de interface: DOM, formatacao, modais, avisos e graficos SVG. */

/** Cria elemento. `attrs.html` injeta HTML, `attrs.text` injeta texto, `on*` vira listener. */
export function el(tag, attrs = {}, filhos = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const f of [].concat(filhos)) {
    if (f === null || f === undefined || f === false) continue;
    n.appendChild(typeof f === 'string' ? document.createTextNode(f) : f);
  }
  return n;
}

/** Acrescenta filhos ignorando nulos — o `append` nativo insere o texto "null". */
export function anexar(pai, ...filhos) {
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    pai.append(f);
  }
  return pai;
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
export const limpar = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };

/* ---------------- Formatacao ---------------- */
export const dinheiro = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const numero = (v, casas = 0) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const percentual = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

const paraData = (iso) => {
  if (!iso) return null;
  const s = String(iso);
  const d = s.includes('T') || s.endsWith('Z') ? new Date(s) : new Date(s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? null : d;
};
export const dataHora = (iso) => { const d = paraData(iso); return d ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; };
export const dataCurta = (iso) => { const d = paraData(iso); return d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—'; };
export const dataBR = (iso) => { const d = paraData(iso); return d ? d.toLocaleDateString('pt-BR') : '—'; };
export const hoje = () => new Date().toISOString().slice(0, 10);
export const diasAtras = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
export const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const telefoneBR = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v || '';
};

/* ---------------- Avisos ---------------- */
export function toast(mensagem, tipo = '') {
  const t = el('div', { class: `toast ${tipo}`, text: mensagem });
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, tipo === 'erro' ? 5200 : 3200);
}
export const sucesso = (m) => toast(m, 'ok');
export const erro = (m) => toast(m, 'erro');

/* ---------------- Modal ---------------- */
export function modal({ titulo, corpo, acoes = [], largo = false, aoFechar }) {
  const fundo = el('div', { class: 'modal-fundo' });
  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', esc); aoFechar?.(); };
  const esc = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', esc);
  fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fechar(); });

  const rodape = acoes.length ? el('div', { class: 'modal-rodape' }, acoes.map(a =>
    el('button', { class: `btn ${a.class || 'btn-vazio'}`, type: 'button', onclick: () => a.acao?.(fechar) }, a.rotulo))) : null;

  fundo.appendChild(el('div', { class: `modal ${largo ? 'largo' : ''}` }, [
    el('div', { class: 'modal-cab' }, [el('h3', { text: titulo }), el('button', { class: 'btn btn-icone', onclick: fechar, 'aria-label': 'Fechar' }, '✕')]),
    el('div', { class: 'modal-corpo' }, corpo),
    rodape
  ]));
  $('#modais').appendChild(fundo);
  setTimeout(() => $('input,select,textarea', fundo)?.focus(), 60);
  return { fechar, elemento: fundo };
}

export function confirmar(mensagem, { titulo = 'Confirmar', perigo = false } = {}) {
  return new Promise((resolve) => {
    modal({
      titulo, corpo: el('p', { text: mensagem, style: { margin: 0 } }),
      acoes: [
        { rotulo: 'Cancelar', acao: (f) => { f(); resolve(false); } },
        { rotulo: 'Confirmar', class: perigo ? 'btn-perigo' : 'btn-primario', acao: (f) => { f(); resolve(true); } }
      ],
      aoFechar: () => resolve(false)
    });
  });
}

/* ---------------- Estados ---------------- */
export const vazio = (texto, icone = '📭') =>
  el('div', { class: 'vazio' }, [el('span', { class: 'icone', text: icone }), el('div', { text: texto })]);

export const carregando = () => el('div', { class: 'vazio', text: 'Carregando…' });

export function kpi({ rotulo, valor, detalhe, cor = '', delta }) {
  return el('div', { class: `kpi ${cor}` }, [
    el('div', { class: 'rot', text: rotulo }),
    el('div', { class: 'val', text: valor }),
    detalhe || delta !== undefined
      ? el('div', { class: 'det' }, [
          delta !== undefined && delta !== null
            ? el('span', { class: `delta ${delta >= 0 ? 'pos' : 'neg'}`, text: `${delta >= 0 ? '+' : ''}${percentual(delta)}` })
            : null,
          detalhe ? el('span', { text: (delta !== undefined && delta !== null ? ' ' : '') + detalhe }) : null
        ])
      : null
  ]);
}

/* ---------------- Graficos SVG ---------------- */
const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  return n;
};

/** Grafico de linha/area com eixo Y automatico. dados: [{rotulo, valor}] */
export function graficoLinha(dados, { altura = 210, cor = '#1567C4', preenche = true, formato = dinheiro } = {}) {
  const larg = 720, pad = { t: 14, r: 12, b: 26, l: 62 };
  const svg = svgEl('svg', { class: 'grafico', viewBox: `0 0 ${larg} ${altura}`, preserveAspectRatio: 'none', height: altura });
  if (!dados.length) return el('div', { class: 'vazio', text: 'Sem dados no período' });

  const max = Math.max(...dados.map(d => d.valor), 1);
  const x = (i) => pad.l + (dados.length === 1 ? (larg - pad.l - pad.r) / 2 : i * (larg - pad.l - pad.r) / (dados.length - 1));
  const y = (v) => altura - pad.b - (v / max) * (altura - pad.t - pad.b);

  for (let i = 0; i <= 3; i++) {
    const v = max * i / 3, yy = y(v);
    svg.appendChild(svgEl('line', { x1: pad.l, x2: larg - pad.r, y1: yy, y2: yy, stroke: '#E2E9F0', 'stroke-width': 1 }));
    const t = svgEl('text', { x: pad.l - 8, y: yy + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#6B7C8F' });
    t.textContent = formato === dinheiro ? dinheiro(v).replace('R$', '').trim() : numero(v);
    svg.appendChild(t);
  }

  const pontos = dados.map((d, i) => `${x(i)},${y(d.valor)}`).join(' ');
  if (preenche) {
    svg.appendChild(svgEl('polygon', {
      points: `${pad.l},${altura - pad.b} ${pontos} ${x(dados.length - 1)},${altura - pad.b}`,
      fill: cor, opacity: .12
    }));
  }
  svg.appendChild(svgEl('polyline', { points: pontos, fill: 'none', stroke: cor, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));

  const passo = Math.max(1, Math.ceil(dados.length / 9));
  dados.forEach((d, i) => {
    if (dados.length <= 40) svg.appendChild(svgEl('circle', { cx: x(i), cy: y(d.valor), r: 3, fill: cor }));
    if (i % passo === 0 || i === dados.length - 1) {
      const t = svgEl('text', { x: x(i), y: altura - 8, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#6B7C8F' });
      t.textContent = d.rotulo;
      svg.appendChild(t);
    }
    const titulo = svgEl('title'); titulo.textContent = `${d.rotulo}: ${formato(d.valor)}`;
    const alvo = svgEl('rect', { x: x(i) - 8, y: pad.t, width: 16, height: altura - pad.t - pad.b, fill: 'transparent' });
    alvo.appendChild(titulo); svg.appendChild(alvo);
  });
  return svg;
}

/** Barras horizontais. dados: [{rotulo, valor, cor?}] */
export function graficoBarras(dados, { formato = dinheiro, cor = '#1567C4', max: maxForcado } = {}) {
  if (!dados.length) return el('div', { class: 'vazio', text: 'Sem dados no período' });
  const max = maxForcado || Math.max(...dados.map(d => d.valor), 1);
  return el('div', { class: 'grid', style: { gap: '11px' } }, dados.map(d =>
    el('div', {}, [
      el('div', { class: 'flex', style: { justifyContent: 'space-between', marginBottom: '4px' } }, [
        el('span', { class: 'pequeno negrito', text: d.rotulo }),
        el('span', { class: 'pequeno', text: formato(d.valor) })
      ]),
      el('div', { class: 'barra-fundo' }, [
        el('div', { style: { width: `${Math.max(2, d.valor / max * 100)}%`, background: d.cor || cor } })
      ])
    ])
  ));
}

/** Rosca com legenda. dados: [{rotulo, valor}] */
export function graficoRosca(dados, { cores = ['#1567C4', '#FFB300', '#2FA968', '#0A3D75', '#E8A400', '#1F7A4C', '#6B7C8F'] } = {}) {
  const total = dados.reduce((a, d) => a + d.valor, 0);
  if (!total) return el('div', { class: 'vazio', text: 'Sem dados no período' });
  const svg = svgEl('svg', { viewBox: '0 0 42 42', style: 'width:150px;height:150px;flex:0 0 auto' });
  svg.appendChild(svgEl('circle', { cx: 21, cy: 21, r: 15.9, fill: 'transparent', stroke: '#F0F4F8', 'stroke-width': 6 }));
  let offset = 25;
  dados.forEach((d, i) => {
    const p = d.valor / total * 100;
    const arco = svgEl('circle', {
      cx: 21, cy: 21, r: 15.9, fill: 'transparent', stroke: cores[i % cores.length], 'stroke-width': 6,
      'stroke-dasharray': `${p} ${100 - p}`, 'stroke-dashoffset': offset
    });
    const t = svgEl('title'); t.textContent = `${d.rotulo}: ${dinheiro(d.valor)} (${p.toFixed(1)}%)`;
    arco.appendChild(t); svg.appendChild(arco);
    offset -= p;
  });
  return el('div', { class: 'flex quebra', style: { gap: '18px', alignItems: 'center' } }, [
    svg,
    el('div', { class: 'legenda', style: { flexDirection: 'column', gap: '7px' } }, dados.map((d, i) =>
      el('span', {}, [
        el('i', { style: { background: cores[i % cores.length] } }),
        el('span', { text: `${d.rotulo} — ${dinheiro(d.valor)} (${(d.valor / total * 100).toFixed(1)}%)` })
      ])
    ))
  ]);
}

/* ---------------- Upload de imagem ---------------- */
/** Le o arquivo, reduz para no maximo `maxLado` px e devolve um data URL JPEG. */
export function lerImagemReduzida(arquivo, maxLado = 1400, qualidade = 0.78) {
  return new Promise((resolve, reject) => {
    if (!arquivo) return reject(new Error('Nenhum arquivo selecionado'));
    if (arquivo.type === 'application/pdf') {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('Não foi possível ler o arquivo'));
      return fr.readAsDataURL(arquivo);
    }
    if (!arquivo.type.startsWith('image/')) return reject(new Error('Envie uma imagem (JPG, PNG) ou PDF'));
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', qualidade));
      };
      img.onerror = () => reject(new Error('Imagem inválida'));
      img.src = fr.result;
    };
    fr.onerror = () => reject(new Error('Não foi possível ler o arquivo'));
    fr.readAsDataURL(arquivo);
  });
}

/** Campo de upload com previa. Devolve { elemento, valor() }. */
export function campoUpload({ rotulo = 'Comprovante de pagamento', valorInicial = null } = {}) {
  let dados = valorInicial;
  const previa = el('img', { class: 'upload-previa', hidden: !valorInicial, src: valorInicial || '' });
  const info = el('div', { class: 'pequeno texto-mudo', style: { marginTop: '6px' } });
  const entrada = el('input', { type: 'file', accept: 'image/*,application/pdf', capture: 'environment', style: { display: 'none' } });
  const area = el('div', { class: 'upload-area', onclick: () => entrada.click() },
    '📷 Toque para tirar a foto ou enviar o print do comprovante');

  entrada.addEventListener('change', async () => {
    const arq = entrada.files[0];
    if (!arq) return;
    try {
      dados = await lerImagemReduzida(arq);
      if (dados.startsWith('data:application/pdf')) {
        previa.hidden = true; info.textContent = `PDF anexado: ${arq.name}`;
      } else {
        previa.src = dados; previa.hidden = false;
        info.textContent = `Imagem anexada (${Math.round(dados.length / 1365)} KB aprox.)`;
      }
    } catch (e) { erro(e.message); }
  });

  return {
    elemento: el('div', { class: 'campo' }, [
      rotulo ? el('label', { text: rotulo }) : null, area, entrada, previa, info
    ]),
    valor: () => dados,
    limpar: () => { dados = null; previa.hidden = true; info.textContent = ''; entrada.value = ''; }
  };
}

/* ---------------- WhatsApp ---------------- */
export const linkWhatsApp = (numero, texto) =>
  numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
         : `https://wa.me/?text=${encodeURIComponent(texto)}`;

export function abrirWhatsApp(numero, texto) {
  window.open(linkWhatsApp(numero, texto), '_blank', 'noopener');
}

/** Copia texto para a area de transferencia com fallback para navegadores antigos. */
export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    sucesso('Copiado para a área de transferência');
  } catch {
    const t = el('textarea', { style: { position: 'fixed', opacity: '0' } });
    t.value = texto; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); sucesso('Copiado'); } catch { erro('Não foi possível copiar'); }
    t.remove();
  }
}
