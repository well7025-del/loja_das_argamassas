/* Componentes e utilitários de interface do aplicativo de celular. */

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

export const $ = (s, r = document) => r.querySelector(s);
export const limpar = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };

/* ---------------- Formatação ---------------- */
export const dinheiro = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const numero = (v, c = 0) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
export const percentual = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

const data = (iso) => { const d = new Date(iso); return isNaN(d) ? null : d; };
export const dataHora = (iso) => data(iso)?.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) || '—';
export const dataBR = (iso) => data(iso)?.toLocaleDateString('pt-BR') || '—';
export const dataCurta = (iso) => data(iso)?.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) || '—';
export const hoje = () => new Date().toISOString().slice(0, 10);
export const diasAtras = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
export const tamanho = (b) => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

export const telefoneBR = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v || '';
};
export const numeroWhatsApp = (telefone) => {
  let d = String(telefone || '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d.length >= 12 ? d : null;
};
export const abrirWhatsApp = (numero, texto) =>
  window.open(numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
                     : `https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');

/* ---------------- Avisos ---------------- */
export function aviso(mensagem, tipo = '') {
  const t = el('div', { class: `torrada ${tipo}`, text: mensagem });
  $('#avisos').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); },
    tipo === 'erro' ? 5000 : 2800);
}
export const sucesso = (m) => aviso(m, 'ok');
export const erro = (m) => aviso(m, 'erro');

/* ---------------- Painel (folha que sobe) ---------------- */
export function painel({ titulo, corpo, acoes = [], aoFechar }) {
  const fundo = el('div', { class: 'fundo-painel' });
  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', esc); aoFechar?.(); };
  const esc = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', esc);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });

  fundo.appendChild(el('div', { class: 'painel' }, [
    el('div', { class: 'painel-cab' }, [
      el('h3', { text: titulo }),
      el('button', { class: 'btn btn-vazio btn-sm', onclick: fechar, 'aria-label': 'Fechar' }, '✕')
    ]),
    el('div', { class: 'painel-corpo' }, corpo),
    acoes.length ? el('div', { class: 'painel-rodape' }, acoes.map(a =>
      el('button', { class: `btn ${a.class || 'btn-vazio'}`, type: 'button', onclick: () => a.acao?.(fechar) }, a.rotulo)
    )) : null
  ]));
  $('#paineis').appendChild(fundo);
  return { fechar, elemento: fundo };
}

export function confirmar(mensagem, { titulo = 'Confirmar', perigo = false } = {}) {
  return new Promise((resolve) => {
    let respondido = false;
    const responder = (v, f) => { respondido = true; f?.(); resolve(v); };
    painel({
      titulo, corpo: el('p', { text: mensagem, style: { margin: 0, fontSize: '15px' } }),
      acoes: [
        { rotulo: 'Cancelar', acao: (f) => responder(false, f) },
        { rotulo: 'Confirmar', class: perigo ? 'btn-perigo' : 'btn-primario', acao: (f) => responder(true, f) }
      ],
      aoFechar: () => { if (!respondido) resolve(false); }
    });
  });
}

/* ---------------- Blocos prontos ---------------- */
export const vazio = (texto, icone = '📭') =>
  el('div', { class: 'vazio' }, [el('span', { class: 'ico', text: icone }), el('div', { text: texto })]);

export const carregando = () => el('div', { class: 'vazio', text: 'Carregando…' });

export const kpi = ({ rot, val, det, cor = '' }) =>
  el('div', { class: `kpi ${cor}` }, [
    el('div', { class: 'rot', text: rot }),
    el('div', { class: 'val', text: val }),
    det ? el('div', { class: 'det', text: det }) : null
  ]);

export const cartao = (titulo, corpo, acao = null) =>
  el('div', { class: 'cartao' }, [
    titulo ? el('div', { class: 'cartao-cab' }, [el('h3', { text: titulo }), acao]) : null,
    corpo
  ]);

/** Barras horizontais simples — o gráfico que cabe bem num celular. */
export function barras(dados, { formato = dinheiro, cor = '#1567C4' } = {}) {
  if (!dados.length) return vazio('Sem dados no período', '📊');
  const max = Math.max(...dados.map(d => d.valor), 1);
  return el('div', {}, dados.map(d => el('div', { style: { marginBottom: '11px' } }, [
    el('div', { class: 'flex', style: { justifyContent: 'space-between', marginBottom: '4px' } }, [
      el('span', { class: 'pq negrito', text: d.rotulo }),
      el('span', { class: 'pq', text: formato(d.valor) })
    ]),
    el('div', { class: 'barra-fundo' }, el('div', { style: { width: `${Math.max(2, d.valor / max * 100)}%`, background: d.cor || cor } }))
  ])));
}

/** Linha do faturamento por dia, em SVG. */
export function linha(dados, { altura = 150, cor = '#2FA968' } = {}) {
  if (!dados.length) return vazio('Sem vendas no período', '📈');
  const NS = 'http://www.w3.org/2000/svg';
  const larg = 600, pad = { t: 10, r: 8, b: 22, l: 8 };
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'grafico');
  svg.setAttribute('viewBox', `0 0 ${larg} ${altura}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.height = `${altura}px`;

  const max = Math.max(...dados.map(d => d.valor), 1);
  const x = (i) => pad.l + (dados.length === 1 ? (larg - pad.l - pad.r) / 2 : i * (larg - pad.l - pad.r) / (dados.length - 1));
  const y = (v) => altura - pad.b - (v / max) * (altura - pad.t - pad.b);
  const pontos = dados.map((d, i) => `${x(i)},${y(d.valor)}`).join(' ');

  const area = document.createElementNS(NS, 'polygon');
  area.setAttribute('points', `${pad.l},${altura - pad.b} ${pontos} ${x(dados.length - 1)},${altura - pad.b}`);
  area.setAttribute('fill', cor); area.setAttribute('opacity', '.14');
  svg.appendChild(area);

  const traco = document.createElementNS(NS, 'polyline');
  traco.setAttribute('points', pontos); traco.setAttribute('fill', 'none');
  traco.setAttribute('stroke', cor); traco.setAttribute('stroke-width', '2.5');
  traco.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(traco);

  const passo = Math.max(1, Math.ceil(dados.length / 6));
  dados.forEach((d, i) => {
    if (i % passo === 0 || i === dados.length - 1) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', x(i)); t.setAttribute('y', altura - 6);
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '11'); t.setAttribute('fill', '#6B7C8F');
      t.textContent = d.rotulo;
      svg.appendChild(t);
    }
  });
  return svg;
}

/* ---------------- Foto / comprovante ---------------- */

/** Lê a foto e reduz antes de guardar — o celular não pode encher de imagem crua. */
export function lerFoto(arquivo, maxLado = 1200, qualidade = 0.72) {
  return new Promise((resolve, reject) => {
    if (!arquivo) return reject(new Error('Nenhuma foto escolhida'));
    if (!arquivo.type.startsWith('image/')) return reject(new Error('Escolha uma imagem'));
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * escala);
        c.height = Math.round(img.height * escala);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', qualidade));
      };
      img.onerror = () => reject(new Error('Não consegui abrir esta imagem'));
      img.src = fr.result;
    };
    fr.onerror = () => reject(new Error('Não consegui ler o arquivo'));
    fr.readAsDataURL(arquivo);
  });
}

export function campoFoto({ rotulo = 'Comprovante de pagamento' } = {}) {
  let dados = null;
  const previa = el('img', { class: 'previa', hidden: true });
  const info = el('div', { class: 'pq mudo', style: { marginTop: '6px' } });
  const entrada = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } });
  const area = el('div', { class: 'upload', onclick: () => entrada.click() }, '📷 Tirar foto ou escolher o print');

  entrada.addEventListener('change', async () => {
    if (!entrada.files[0]) return;
    try {
      dados = await lerFoto(entrada.files[0]);
      previa.src = dados; previa.hidden = false;
      info.textContent = `Foto anexada (${tamanho(dados.length * 0.75)})`;
    } catch (e) { erro(e.message); }
  });

  return {
    elemento: el('div', { class: 'campo' }, [rotulo ? el('label', { text: rotulo }) : null, area, entrada, previa, info]),
    valor: () => dados,
    limpar: () => { dados = null; previa.hidden = true; info.textContent = ''; entrada.value = ''; }
  };
}

/* ---------------- Diversos ---------------- */
export async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); sucesso('Copiado'); }
  catch {
    const t = el('textarea', { style: { position: 'fixed', opacity: '0' } });
    t.value = texto; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); sucesso('Copiado'); } catch { erro('Não foi possível copiar'); }
    t.remove();
  }
}

/** Evita disparar a busca a cada tecla digitada. */
export function atrasar(fn, ms = 280) {
  let id;
  return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}
