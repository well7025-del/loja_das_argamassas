/* Campanhas de WhatsApp: monta a audiencia, agenda o disparo e abre a fila de envio. */
import { api } from '../api.js';
import { estado, ehMaster } from '../app.js';
import { el, limpar, dataHora, erro, sucesso, modal, vazio, abrirWhatsApp, copiar, telefoneBR, confirmar, numero } from '../ui.js';

const AUDIENCIAS = [
  { id: 'todos', rotulo: 'Todos os clientes com telefone' },
  { id: 'loja', rotulo: 'Clientes de uma loja específica' },
  { id: 'compraram', rotulo: 'Quem comprou nos últimos X dias' },
  { id: 'inativos', rotulo: 'Quem NÃO compra há X dias (reativação)' }
];
const MODELOS = [
  { nome: 'Promoção', texto: 'Olá {{nome}}! 👋\n\nA {{loja}} está com promoção especial em argamassas e rejuntes esta semana.\n\nPassa aqui pra conferir os preços — o estoque é limitado!' },
  { nome: 'Produto novo', texto: 'Oi {{nome}}, tudo bem?\n\nChegou novidade na {{loja}}: linha nova de argamassa para porcelanato, com melhor rendimento e mesmo preço.\n\nQuer que eu separe uma para você?' },
  { nome: 'Reativação', texto: 'Olá {{nome}}! 😊\n\nFaz um tempo que você não passa na {{loja}}. Preparamos uma condição especial pra sua próxima compra.\n\nMe chama aqui que eu te passo os valores!' },
  { nome: 'Entrega/obra', texto: 'Olá {{nome}}!\n\nAqui é da {{loja}}. Temos entrega para a sua região — é só montar o pedido pelo WhatsApp que levamos até a obra.\n\nPosso montar um orçamento?' }
];
const CORES_STATUS = { agendada: 'tag-azul', em_andamento: 'tag-amarelo', concluida: 'tag-verde', cancelada: 'tag-cinza', rascunho: 'tag-cinza' };
const NOMES_STATUS = { agendada: 'Agendada', em_andamento: 'Pronta para enviar', concluida: 'Concluída', cancelada: 'Cancelada', rascunho: 'Rascunho' };

export async function render(raiz) {
  const corpo = el('div');
  raiz.append(
    el('div', { class: 'filtros' }, [
      el('div', { style: { flex: '1' } }, [
        el('h3', { text: 'Campanhas de WhatsApp' }),
        el('div', { class: 'pequeno texto-mudo', text: 'Monte a mensagem, escolha o público e agende. Na hora do disparo o sistema abre a fila com a conversa de cada cliente já preenchida.' })
      ]),
      el('button', { class: 'btn btn-acao', onclick: () => formulario() }, '+ Nova campanha')
    ]),
    corpo
  );

  async function carregar() {
    limpar(corpo).appendChild(el('div', { class: 'vazio', text: 'Carregando…' }));
    const { campanhas } = await api.get('/api/campanhas');
    limpar(corpo);
    if (!campanhas.length) {
      corpo.appendChild(vazio('Nenhuma campanha criada. Comece com uma mensagem de promoção para todos os clientes.', '💬'));
      return;
    }
    corpo.appendChild(el('div', { class: 'grid g2' }, campanhas.map(c => el('div', { class: 'card' }, [
      el('div', { class: 'card-cab' }, [
        el('h3', { text: c.name }),
        el('div', { class: 'espaco' }),
        el('span', { class: `tag ${CORES_STATUS[c.status]}`, text: NOMES_STATUS[c.status] || c.status })
      ]),
      el('div', { class: 'card-corpo' }, [
        el('div', { class: 'relatorio-ia pequeno', style: { background: 'var(--cinza-100)', padding: '11px', borderRadius: '8px', marginBottom: '11px' }, text: c.message }),
        el('div', { class: 'pequeno texto-mudo mb', text:
          `${c.enviadas} de ${c.total} enviadas${c.scheduled_at ? ` · agendada para ${dataHora(c.scheduled_at)}` : ''}${c.store_name ? ` · ${c.store_name}` : ''}` }),
        el('div', { class: 'barra-fundo mb' }, el('div', { style: { width: `${c.total ? c.enviadas / c.total * 100 : 0}%`, background: 'var(--verde-500)' } })),
        el('div', { class: 'flex quebra' }, [
          el('button', { class: 'btn btn-ok', onclick: () => abrirFila(c.id) }, '📤 Abrir fila de envio'),
          el('button', { class: 'btn btn-vazio btn-sm', onclick: async () => {
            if (!await confirmar(`Excluir a campanha "${c.name}"?`, { perigo: true })) return;
            try { await api.del(`/api/campanhas/${c.id}`); sucesso('Campanha excluída'); carregar(); }
            catch (e) { erro(e.message); }
          } }, '🗑️')
        ])
      ])
    ]))));
  }

  async function abrirFila(id) {
    const { campanha, destinatarios } = await api.get(`/api/campanhas/${id}`);
    const lista = el('div', { class: 'rolagem' });

    function desenhar() {
      limpar(lista);
      const pendentes = destinatarios.filter(d => d.status === 'pendente');
      lista.appendChild(el('div', { class: 'aviso aviso-azul mb', text:
        `${pendentes.length} pendente(s) de ${destinatarios.length}. Clique em "Enviar" para abrir a conversa do cliente com a mensagem pronta — depois confirme o envio para marcar na lista.` }));
      for (const d of destinatarios) {
        lista.appendChild(el('div', { class: 'item-carrinho' }, [
          el('div', { class: 'info' }, [
            el('div', { class: 'nome', text: d.name }),
            el('div', { class: 'sub', text: `${telefoneBR(d.phone)}${d.city ? ' · ' + d.city : ''}` })
          ]),
          d.status === 'enviada'
            ? el('span', { class: 'tag tag-verde', text: '✓ Enviada' })
            : el('div', { class: 'flex' }, [
                el('button', { class: 'btn btn-sm btn-ok', onclick: async () => {
                  abrirWhatsApp(d.whatsapp, d.mensagem);
                  try {
                    await api.post(`/api/campanhas/${id}/enviado`, { target_id: d.target_id });
                    d.status = 'enviada'; desenhar();
                  } catch (e) { erro(e.message); }
                } }, '💬 Enviar'),
                el('button', { class: 'btn btn-sm btn-vazio', title: 'Copiar mensagem', onclick: () => copiar(d.mensagem) }, '📋')
              ])
        ]));
      }
    }
    desenhar();

    modal({
      titulo: `Fila de envio — ${campanha.name}`, largo: true,
      corpo: lista,
      acoes: [{ rotulo: 'Fechar', class: 'btn-primario', acao: (f) => { f(); carregar(); } }]
    });
  }

  function formulario() {
    const nome = el('input', { type: 'text', placeholder: 'Ex.: Promoção de setembro' });
    const mensagem = el('textarea', { style: { minHeight: '150px' },
      placeholder: 'Use {{nome}} para o primeiro nome do cliente e {{loja}} para o nome da empresa.' });
    const audiencia = el('select', {}, AUDIENCIAS.map(a => el('option', { value: a.id, text: a.rotulo })));
    const dias = el('input', { type: 'number', value: '60', min: '1' });
    const seletorLoja = el('select', {}, estado.lojas.filter(l => l.kind === 'loja').map(l => el('option', { value: l.id, text: l.name })));
    const agendamento = el('input', { type: 'datetime-local' });
    const previa = el('div', { class: 'aviso aviso-azul' });
    const linhaDias = el('div', { class: 'campo', hidden: true }, [el('label', { text: 'Dias considerados' }), dias]);
    const linhaLoja = el('div', { class: 'campo', hidden: true }, [el('label', { text: 'Loja' }), seletorLoja]);

    async function atualizarPrevia() {
      linhaDias.hidden = !['compraram', 'inativos'].includes(audiencia.value);
      linhaLoja.hidden = audiencia.value !== 'loja' || !ehMaster();
      try {
        const r = await api.get('/api/campanhas/previa', {
          audience: audiencia.value, days: dias.value,
          store_id: audiencia.value === 'loja' ? seletorLoja.value : undefined
        });
        previa.textContent = r.total
          ? `👥 ${r.total} cliente(s) receberão esta mensagem${r.exemplos.length ? ` — ex.: ${r.exemplos.join(', ')}` : ''}.`
          : 'Nenhum cliente com telefone nessa audiência.';
      } catch (e) { previa.textContent = e.message; }
    }
    audiencia.addEventListener('change', atualizarPrevia);
    dias.addEventListener('change', atualizarPrevia);
    seletorLoja.addEventListener('change', atualizarPrevia);

    const modelos = el('div', { class: 'pdv-categorias' }, MODELOS.map(m =>
      el('button', { class: 'chip', type: 'button', onclick: () => { mensagem.value = m.texto; if (!nome.value) nome.value = m.nome; } }, m.nome)));

    modal({
      titulo: 'Nova campanha de WhatsApp', largo: true,
      corpo: el('div', {}, [
        el('div', { class: 'campo' }, [el('label', { text: 'Nome da campanha *' }), nome]),
        el('label', { class: 'pequeno negrito', text: 'Modelos prontos' }), modelos,
        el('div', { class: 'campo' }, [
          el('label', {}, ['Mensagem * ', el('span', { class: 'dica', text: '— {{nome}} e {{loja}} são substituídos automaticamente' })]),
          mensagem
        ]),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Público' }), audiencia]),
          linhaDias, linhaLoja,
          el('div', { class: 'campo' }, [el('label', { text: 'Agendar para (opcional)' }), agendamento])
        ]),
        previa,
        el('div', { class: 'aviso aviso-amarelo mt' },
          'O envio é feito pelo seu próprio WhatsApp: na hora agendada o sistema avisa e monta a fila com a conversa de cada cliente já preenchida. Assim não é preciso contratar API paga nem correr risco de bloqueio por envio automático em massa.')
      ]),
      acoes: [{
        rotulo: 'Criar campanha', class: 'btn-primario', acao: async (fechar) => {
          if (!nome.value.trim() || !mensagem.value.trim()) { erro('Preencha o nome e a mensagem'); return; }
          try {
            const r = await api.post('/api/campanhas', {
              name: nome.value, message: mensagem.value, audience: audiencia.value,
              days: Number(dias.value), scheduled_at: agendamento.value || null,
              store_id: audiencia.value === 'loja' ? Number(seletorLoja.value) : undefined
            });
            sucesso(`Campanha criada para ${numero(r.destinatarios)} cliente(s)`);
            fechar(); carregar();
          } catch (e) { erro(e.message); }
        }
      }]
    });
    atualizarPrevia();
  }

  carregar();
}
