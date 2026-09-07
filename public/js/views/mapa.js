/* Mapa de densidade de vendas a partir do CEP dos clientes atendidos no periodo. */
import { api } from '../api.js';
import { estado } from '../app.js';
import { el, limpar, kpi, dinheiro, numero, vazio, diasAtras, hoje, telefoneBR } from '../ui.js';

let mapa = null;

export async function render(raiz) {
  const periodo = { from: diasAtras(89), to: hoje() };
  const corpo = el('div');
  const entradaDe = el('input', { type: 'date', value: periodo.from, onchange: (e) => { periodo.from = e.target.value; carregar(); } });
  const entradaAte = el('input', { type: 'date', value: periodo.to, onchange: (e) => { periodo.to = e.target.value; carregar(); } });
  const seletorCelula = el('select', { onchange: carregar }, [
    el('option', { value: '1', text: 'Grade de 1 km²' }),
    el('option', { value: '2', text: 'Grade de 2 km²' }),
    el('option', { value: '5', text: 'Grade de 5 km²' })
  ]);

  raiz.append(
    el('div', { class: 'filtros' }, [
      el('div', { class: 'campo' }, [el('label', { text: 'De' }), entradaDe]),
      el('div', { class: 'campo' }, [el('label', { text: 'Até' }), entradaAte]),
      el('div', { class: 'campo' }, [el('label', { text: 'Densidade' }), seletorCelula])
    ]),
    corpo
  );

  async function carregar() {
    limpar(corpo).appendChild(el('div', { class: 'vazio', text: 'Carregando mapa…' }));
    const dados = await api.get('/api/stats/mapa', {
      ...periodo, store_id: estado.lojaSelecionada || undefined, celula_km: seletorCelula.value
    });
    limpar(corpo);

    if (!dados.pontos.length) {
      corpo.appendChild(vazio('Nenhum cliente com CEP comprou neste período. Cadastre o CEP dos clientes no PDV para alimentar o mapa.', '🗺️'));
      return;
    }

    const c = dados.cobertura;
    corpo.appendChild(el('div', { class: 'grid g4 mb' }, [
      kpi({ rotulo: 'Clientes no mapa', valor: numero(c.clientes_geolocalizados), cor: 'verde' }),
      kpi({ rotulo: 'Área de cobertura', valor: `${numero(c.area_km2, 1)} km²`, detalhe: `raio médio de ${numero(c.raio_medio_km, 1)} km do centro` }),
      kpi({ rotulo: 'Densidade de clientes', valor: `${numero(c.densidade_clientes_km2, 2)}/km²`, cor: 'amarelo',
            detalhe: 'na área total atendida' }),
      kpi({ rotulo: 'Faturamento por km²', valor: dinheiro(c.densidade_faturamento_km2) })
    ]));

    const areaMapa = el('div', { id: 'mapa' });
    corpo.appendChild(el('div', { class: 'card mb' }, [
      el('div', { class: 'card-cab' }, [
        el('h3', { text: 'Onde estão os clientes que compraram' }),
        el('div', { class: 'espaco' }),
        el('span', { class: 'pequeno texto-mudo', text: dados.aviso })
      ]),
      el('div', { class: 'card-corpo sem-pad' }, areaMapa)
    ]));

    corpo.appendChild(el('div', { class: 'grid g2' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'card-cab' }, [el('h3', { text: `Concentração por ${dados.celula_km} km²` })]),
        el('div', { class: 'tabela-wrap rolagem' }, el('table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: 'Área' }), el('th', { class: 'num', text: 'Clientes' }),
            el('th', { class: 'num', text: 'Compras' }), el('th', { class: 'num', text: 'Faturamento' }),
            el('th', { class: 'num', text: 'Clientes/km²' })
          ])),
          el('tbody', {}, dados.grade.slice(0, 30).map((g, i) => el('tr', {}, [
            el('td', { class: 'pequeno', text: `Área ${i + 1} (${g.lat.toFixed(3)}, ${g.lng.toFixed(3)})` }),
            el('td', { class: 'num', text: numero(g.clientes) }),
            el('td', { class: 'num', text: numero(g.compras) }),
            el('td', { class: 'num negrito', text: dinheiro(g.total) }),
            el('td', { class: 'num', text: numero(g.densidade_clientes_km2, 2) })
          ])))
        ]))
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card-cab' }, [el('h3', { text: 'Por cidade / região' })]),
        el('div', { class: 'tabela-wrap rolagem' }, el('table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: 'Cidade' }), el('th', { class: 'num', text: 'Clientes' }),
            el('th', { class: 'num', text: 'Área' }), el('th', { class: 'num', text: 'Clientes/km²' }),
            el('th', { class: 'num', text: 'Faturamento' })
          ])),
          el('tbody', {}, dados.por_cidade.map(x => el('tr', {}, [
            el('td', { text: x.cidade }),
            el('td', { class: 'num', text: numero(x.clientes) }),
            el('td', { class: 'num pequeno', text: `${numero(x.area_km2, 1)} km²` }),
            el('td', { class: 'num', text: numero(x.densidade_clientes_km2, 2) }),
            el('td', { class: 'num negrito', text: dinheiro(x.total) })
          ])))
        ]))
      ])
    ]));

    if (window.L) desenharLeaflet(areaMapa, dados);
    else areaMapa.replaceWith(desenharSVG(dados));
  }

  function desenharLeaflet(area, dados) {
    if (mapa) { mapa.remove(); mapa = null; }
    const centro = dados.cobertura.centro || { lat: -8.05, lng: -34.9 };
    mapa = L.map(area).setView([centro.lat, centro.lng], dados.cobertura.area_km2 > 500 ? 8 : 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 18
    }).addTo(mapa);

    const maxTotal = Math.max(...dados.grade.map(g => g.total), 1);
    for (const g of dados.grade) {
      const intensidade = g.total / maxTotal;
      L.circle([g.lat, g.lng], {
        radius: dados.celula_km * 500,
        color: intensidade > .66 ? '#C62828' : intensidade > .33 ? '#FFB300' : '#2FA968',
        fillColor: intensidade > .66 ? '#C62828' : intensidade > .33 ? '#FFB300' : '#2FA968',
        fillOpacity: 0.18 + intensidade * 0.28, weight: 1
      }).bindPopup(
        `<b>${g.clientes} cliente(s)</b><br>${g.compras} compra(s)<br>${dinheiro(g.total)}<br>` +
        `${numero(g.densidade_clientes_km2, 2)} clientes/km²`
      ).addTo(mapa);
    }

    for (const p of dados.pontos) {
      L.circleMarker([p.lat, p.lng], { radius: 6, color: '#0A3D75', fillColor: '#1567C4', fillOpacity: .9, weight: 2 })
        .bindPopup(`<b>${p.name}</b><br>${p.cep || ''} ${p.city || ''}<br>${p.compras} compra(s) · ${dinheiro(p.total)}`)
        .addTo(mapa);
    }

    for (const l of dados.lojas) {
      const ponto = dados.pontos.find(x => x.city && l.city && x.city.includes(l.city));
      if (!ponto) continue;
      L.marker([ponto.lat, ponto.lng], {
        icon: L.divIcon({ html: '<div style="font-size:22px">🏬</div>', className: '', iconSize: [24, 24] })
      }).bindPopup(`<b>${l.name}</b>`).addTo(mapa);
    }

    setTimeout(() => mapa.invalidateSize(), 120);
  }

  /** Alternativa sem internet: dispersao dos pontos em SVG mantendo as proporcoes reais. */
  function desenharSVG(dados) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'mapa-svg');
    svg.setAttribute('viewBox', '0 0 800 460');
    const lats = dados.pontos.map(p => p.lat), lngs = dados.pontos.map(p => p.lng);
    const min = { lat: Math.min(...lats), lng: Math.min(...lngs) };
    const max = { lat: Math.max(...lats), lng: Math.max(...lngs) };
    const px = (p) => ({
      x: 60 + ((p.lng - min.lng) / ((max.lng - min.lng) || 1)) * 680,
      y: 400 - ((p.lat - min.lat) / ((max.lat - min.lat) || 1)) * 340
    });
    const maxTotal = Math.max(...dados.grade.map(g => g.total), 1);

    for (const g of dados.grade) {
      const { x, y } = px(g);
      const cir = document.createElementNS(NS, 'circle');
      const i = g.total / maxTotal;
      cir.setAttribute('cx', x); cir.setAttribute('cy', y);
      cir.setAttribute('r', 16 + i * 30);
      cir.setAttribute('fill', i > .66 ? '#C62828' : i > .33 ? '#FFB300' : '#2FA968');
      cir.setAttribute('opacity', 0.22 + i * 0.25);
      const t = document.createElementNS(NS, 'title');
      t.textContent = `${g.clientes} cliente(s) · ${dinheiro(g.total)} · ${numero(g.densidade_clientes_km2, 2)} clientes/km²`;
      cir.appendChild(t); svg.appendChild(cir);
    }
    for (const p of dados.pontos) {
      const { x, y } = px(p);
      const cir = document.createElementNS(NS, 'circle');
      cir.setAttribute('cx', x); cir.setAttribute('cy', y); cir.setAttribute('r', 5);
      cir.setAttribute('fill', '#1567C4'); cir.setAttribute('stroke', '#0A3D75'); cir.setAttribute('stroke-width', '2');
      const t = document.createElementNS(NS, 'title');
      t.textContent = `${p.name} — ${p.city || ''} · ${dinheiro(p.total)}`;
      cir.appendChild(t); svg.appendChild(cir);
    }
    // rotula cada cidade no centro dos seus pontos
    const cidades = new Map();
    for (const p of dados.pontos) {
      const nome = `${p.city || 'Não informado'}${p.uf ? '/' + p.uf : ''}`;
      const c = cidades.get(nome) || { lat: 0, lng: 0, n: 0 };
      c.lat += p.lat; c.lng += p.lng; c.n++;
      cidades.set(nome, c);
    }
    for (const [nome, c] of cidades) {
      const { x, y } = px({ lat: c.lat / c.n, lng: c.lng / c.n });
      const rotulo = document.createElementNS(NS, 'text');
      rotulo.setAttribute('x', x); rotulo.setAttribute('y', y - 26);
      rotulo.setAttribute('text-anchor', 'middle'); rotulo.setAttribute('font-size', '12');
      rotulo.setAttribute('font-weight', '700'); rotulo.setAttribute('fill', '#0A3D75');
      rotulo.textContent = `${nome} (${c.n})`;
      svg.appendChild(rotulo);
    }

    const legenda = document.createElementNS(NS, 'text');
    legenda.setAttribute('x', 16); legenda.setAttribute('y', 442);
    legenda.setAttribute('font-size', '13'); legenda.setAttribute('fill', '#6B7C8F');
    legenda.textContent = 'Mapa simplificado (sem conexão com o serviço de mapas) — posições relativas pelo CEP.';
    svg.appendChild(legenda);
    return svg;
  }

  carregar();
  return { destruir: () => { if (mapa) { mapa.remove(); mapa = null; } } };
}
