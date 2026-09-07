/* Cadastro e gestao de clientes — base do mapa de vendas e das campanhas. */
import { api } from '../api.js';
import { estado, ehMaster, lojaAtual } from '../app.js';
import {
  el, limpar, dinheiro, numero, dataBR, erro, sucesso, modal, vazio,
  telefoneBR, abrirWhatsApp, confirmar
} from '../ui.js';
import { vozDisponivel, criarReconhecedor, interpretarCliente } from '../voice.js';

export async function render(raiz) {
  const corpo = el('div');
  const entradaBusca = el('input', { type: 'search', placeholder: 'Nome, telefone, documento ou cidade…' });
  let debounce;
  entradaBusca.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(carregar, 280); });

  raiz.append(
    el('div', { class: 'filtros' }, [
      el('div', { class: 'campo', style: { flex: '3' } }, [el('label', { text: 'Buscar cliente' }), entradaBusca]),
      el('button', { class: 'btn btn-acao', onclick: () => formulario() }, '+ Novo cliente')
    ]),
    corpo
  );

  async function carregar() {
    limpar(corpo).appendChild(el('div', { class: 'vazio', text: 'Carregando…' }));
    const { clientes } = await api.get('/api/clientes', { q: entradaBusca.value, store_id: estado.lojaSelecionada || undefined });
    limpar(corpo);
    if (!clientes.length) { corpo.appendChild(vazio('Nenhum cliente cadastrado ainda', '👥')); return; }

    const totalComprado = clientes.reduce((a, c) => a + (c.total_comprado || 0), 0);
    const comWhats = clientes.filter(c => c.phone).length;
    const comCep = clientes.filter(c => c.cep).length;
    corpo.appendChild(el('div', { class: 'grid g4 mb' }, [
      el('div', { class: 'kpi' }, [el('div', { class: 'rot', text: 'Clientes' }), el('div', { class: 'val', text: numero(clientes.length) })]),
      el('div', { class: 'kpi verde' }, [el('div', { class: 'rot', text: 'Já compraram' }), el('div', { class: 'val', text: dinheiro(totalComprado) })]),
      el('div', { class: 'kpi amarelo' }, [el('div', { class: 'rot', text: 'Com WhatsApp' }), el('div', { class: 'val', text: numero(comWhats) }), el('div', { class: 'det', text: 'alcançáveis por campanha' })]),
      el('div', { class: 'kpi' }, [el('div', { class: 'rot', text: 'Com CEP' }), el('div', { class: 'val', text: numero(comCep) }), el('div', { class: 'det', text: 'aparecem no mapa' })])
    ]));

    corpo.appendChild(el('div', { class: 'card' }, el('div', { class: 'tabela-wrap' }, el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Cliente' }), el('th', { text: 'Contato' }), el('th', { text: 'Local' }),
        el('th', { class: 'num', text: 'Compras' }), el('th', { class: 'num', text: 'Total' }),
        el('th', { text: 'Última' }), el('th', { text: '' })
      ])),
      el('tbody', {}, clientes.map(c => el('tr', {}, [
        el('td', {}, [
          el('div', { class: 'negrito', text: c.name }),
          c.store_name ? el('div', { class: 'pequeno texto-mudo', text: c.store_name }) : null
        ]),
        el('td', { class: 'pequeno' }, [
          c.phone ? el('div', { text: telefoneBR(c.phone) }) : el('span', { class: 'texto-mudo', text: 'sem telefone' }),
          c.email ? el('div', { class: 'texto-mudo', text: c.email }) : null
        ]),
        el('td', { class: 'pequeno' }, [
          el('div', { text: [c.city, c.uf].filter(Boolean).join('/') || '—' }),
          c.cep ? el('div', { class: 'texto-mudo', text: c.cep }) : null
        ]),
        el('td', { class: 'num', text: numero(c.compras) }),
        el('td', { class: 'num negrito', text: dinheiro(c.total_comprado) }),
        el('td', { class: 'pequeno', text: c.ultima_compra ? dataBR(c.ultima_compra) : '—' }),
        el('td', { class: 'num' }, el('div', { class: 'flex flex-fim' }, [
          c.phone ? el('button', { class: 'btn btn-sm btn-ok', title: 'Falar no WhatsApp',
            onclick: () => abrirWhatsApp(String(c.phone).replace(/\D/g, '').length > 11 ? c.phone : '55' + String(c.phone).replace(/\D/g, ''), `Olá ${c.name.split(' ')[0]}! Aqui é da Loja das Argamassas.`) }, '💬') : null,
          el('button', { class: 'btn btn-sm btn-vazio', onclick: () => detalhe(c.id) }, 'Ver')
        ]))
      ])))
    ]))));
  }

  async function detalhe(id) {
    const { cliente, compras, whatsapp } = await api.get(`/api/clientes/${id}`);
    modal({
      titulo: cliente.name, largo: true,
      corpo: el('div', {}, [
        el('div', { class: 'grid g2 mb' }, [
          el('div', {}, [
            el('div', { class: 'pequeno texto-mudo', text: 'Contato' }),
            el('div', { text: telefoneBR(cliente.phone) || 'Sem telefone' }),
            cliente.email ? el('div', { class: 'pequeno', text: cliente.email }) : null,
            cliente.doc ? el('div', { class: 'pequeno texto-mudo', text: `Doc.: ${cliente.doc}` }) : null
          ]),
          el('div', {}, [
            el('div', { class: 'pequeno texto-mudo', text: 'Endereço' }),
            el('div', { text: [cliente.address, cliente.number].filter(Boolean).join(', ') || '—' }),
            el('div', { class: 'pequeno', text: [cliente.district, cliente.city, cliente.uf].filter(Boolean).join(' · ') }),
            cliente.cep ? el('div', { class: 'pequeno texto-mudo', text: `CEP ${cliente.cep}${cliente.lat ? ' · localizado no mapa' : ''}` }) : null
          ])
        ]),
        cliente.notes ? el('div', { class: 'aviso aviso-amarelo mb', text: cliente.notes }) : null,
        el('h4', { class: 'mb', text: 'Histórico de compras' }),
        compras.length
          ? el('div', { class: 'card' }, el('div', { class: 'tabela-wrap rolagem' }, el('table', {}, [
              el('thead', {}, el('tr', {}, [el('th', { text: 'Venda' }), el('th', { text: 'Data' }), el('th', { text: 'Loja' }), el('th', { class: 'num', text: 'Total' })])),
              el('tbody', {}, compras.map(v => el('tr', {}, [
                el('td', { text: v.code }), el('td', { class: 'pequeno', text: dataBR(v.created_at) }),
                el('td', { class: 'pequeno', text: v.store_name }), el('td', { class: 'num negrito', text: dinheiro(v.total) })
              ])))
            ])))
          : vazio('Este cliente ainda não comprou', '🧾')
      ]),
      acoes: [
        { rotulo: 'Excluir', class: 'btn-perigo', acao: async (fechar) => {
            if (!await confirmar(`Remover ${cliente.name} da lista de clientes?`, { perigo: true })) return;
            try { await api.del(`/api/clientes/${id}`); sucesso('Cliente removido'); fechar(); carregar(); }
            catch (e) { erro(e.message); }
          } },
        whatsapp ? { rotulo: '💬 WhatsApp', class: 'btn-ok', acao: () => abrirWhatsApp(whatsapp, `Olá ${cliente.name.split(' ')[0]}! Aqui é da Loja das Argamassas.`) } : null,
        { rotulo: 'Editar', class: 'btn-primario', acao: (fechar) => { fechar(); formulario(cliente); } }
      ].filter(Boolean)
    });
  }

  function formulario(cliente = null) {
    const campos = {
      name: el('input', { type: 'text', value: cliente?.name || '' }),
      phone: el('input', { type: 'tel', value: cliente?.phone || '', placeholder: '(81) 90000-0000' }),
      email: el('input', { type: 'email', value: cliente?.email || '' }),
      doc: el('input', { type: 'text', value: cliente?.doc || '', placeholder: 'CPF ou CNPJ' }),
      cep: el('input', { type: 'text', value: cliente?.cep || '', placeholder: '00000-000', maxlength: '9' }),
      address: el('input', { type: 'text', value: cliente?.address || '' }),
      number: el('input', { type: 'text', value: cliente?.number || '' }),
      district: el('input', { type: 'text', value: cliente?.district || '' }),
      city: el('input', { type: 'text', value: cliente?.city || '' }),
      uf: el('input', { type: 'text', value: cliente?.uf || '', maxlength: '2' }),
      notes: el('textarea', { placeholder: 'Observações, condições comerciais, obra em andamento…' })
    };
    campos.notes.value = cliente?.notes || '';
    const statusCep = el('div', { class: 'pequeno texto-mudo' });
    const statusVoz = el('div', { class: 'voz-status' });

    campos.cep.addEventListener('blur', async () => {
      const d = campos.cep.value.replace(/\D/g, '');
      if (d.length !== 8) return;
      statusCep.textContent = 'Consultando CEP…';
      try {
        const { endereco } = await api.get(`/api/cep/${d}`);
        if (endereco.street && !campos.address.value) campos.address.value = endereco.street;
        if (endereco.district && !campos.district.value) campos.district.value = endereco.district;
        if (endereco.city) campos.city.value = endereco.city;
        if (endereco.uf) campos.uf.value = endereco.uf;
        statusCep.textContent = endereco.precision === 'rua'
          ? '📍 Endereço localizado com precisão de rua.'
          : '📍 Localização aproximada pela faixa do CEP (suficiente para o mapa de densidade).';
      } catch { statusCep.textContent = 'CEP não encontrado — preencha o endereço manualmente.'; }
    });

    const btnVoz = el('button', { class: 'btn btn-voz btn-bloco', type: 'button' }, '🎤 Ditar dados do cliente');
    let rec = null;
    btnVoz.onclick = () => {
      if (!vozDisponivel()) { erro('Comando de voz não disponível neste navegador. Use o Chrome ou o Edge.'); return; }
      if (rec?.ativo) { rec.parar(); return; }
      rec = criarReconhecedor({
        continuo: false,
        onEstado: (s) => {
          btnVoz.classList.toggle('ouvindo', s === 'ouvindo');
          btnVoz.textContent = s === 'ouvindo' ? '⏹ Parar de ouvir' : '🎤 Ditar dados do cliente';
          if (s === 'ouvindo') statusVoz.textContent = 'Ex.: "nome Maria Souza telefone 81 98888 7777 cep 55014 000"';
        },
        onErro: (m) => { statusVoz.textContent = m; },
        onTexto: (texto, parcial) => {
          statusVoz.textContent = `“${texto}”`;
          if (parcial) return;
          const d = interpretarCliente(texto);
          if (d.name) campos.name.value = d.name;
          if (d.phone) campos.phone.value = d.phone;
          if (d.number) campos.number.value = d.number;
          if (d.cep) { campos.cep.value = d.cep; campos.cep.dispatchEvent(new Event('blur')); }
          statusVoz.textContent = 'Campos preenchidos pela voz. Revise antes de salvar.';
        }
      });
      rec.iniciar();
    };

    modal({
      titulo: cliente ? 'Editar cliente' : 'Novo cliente', largo: true,
      corpo: el('div', {}, [
        btnVoz, statusVoz,
        el('div', { class: 'campo', style: { marginTop: '12px' } }, [el('label', { text: 'Nome *' }), campos.name]),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'WhatsApp / Telefone' }), campos.phone]),
          el('div', { class: 'campo' }, [el('label', { text: 'E-mail' }), campos.email]),
          el('div', { class: 'campo' }, [el('label', { text: 'CPF / CNPJ' }), campos.doc])
        ]),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'CEP' }), campos.cep]),
          el('div', { class: 'campo', style: { flex: '3' } }, [el('label', { text: 'Endereço' }), campos.address]),
          el('div', { class: 'campo', style: { flex: '.6' } }, [el('label', { text: 'Nº' }), campos.number])
        ]),
        statusCep,
        el('div', { class: 'linha', style: { marginTop: '10px' } }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Bairro' }), campos.district]),
          el('div', { class: 'campo' }, [el('label', { text: 'Cidade' }), campos.city]),
          el('div', { class: 'campo', style: { flex: '.4' } }, [el('label', { text: 'UF' }), campos.uf])
        ]),
        el('div', { class: 'campo' }, [el('label', { text: 'Observações' }), campos.notes])
      ]),
      acoes: [{
        rotulo: 'Salvar', class: 'btn-primario', acao: async (fechar) => {
          if (!campos.name.value.trim()) { erro('Informe o nome do cliente'); return; }
          const dados = Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v.value]));
          if (!cliente) dados.store_id = estado.lojaSelecionada || lojaAtual()?.id;
          try {
            rec?.parar();
            if (cliente) await api.put(`/api/clientes/${cliente.id}`, dados);
            else await api.post('/api/clientes', dados);
            sucesso(cliente ? 'Cliente atualizado' : 'Cliente cadastrado');
            fechar(); carregar();
          } catch (e) { erro(e.message); }
        }
      }]
    });
  }

  carregar();
}
