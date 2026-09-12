/* Clientes da loja: cadastro simples e histórico de compras. */
import { listar, salvar, remover } from '../db.js';
import {
  el, limpar, dinheiro, numero, dataBR, erro, sucesso, painel, vazio,
  telefoneBR, numeroWhatsApp, abrirWhatsApp, confirmar, atrasar, kpi, anexar } from '../ui.js';
import { vozDisponivel, criarReconhecedor, interpretarCliente } from '../voice.js';

export async function render(raiz) {
  const corpo = el('div');
  const busca = el('input', { type: 'search', placeholder: 'Nome, telefone ou cidade…' });
  busca.addEventListener('input', atrasar(desenhar, 220));

  raiz.append(
    el('div', { class: 'campo' }, [busca]),
    el('button', { class: 'btn btn-acao btn-bloco mb', onclick: () => formulario() }, '+ Novo cliente'),
    corpo
  );

  async function desenhar() {
    const [clientes, vendas] = await Promise.all([listar('clientes'), listar('vendas')]);
    const porCliente = new Map();
    for (const v of vendas.filter(v => !v.cancelada && v.clienteId)) {
      const atual = porCliente.get(v.clienteId) || { compras: 0, total: 0, ultima: null };
      atual.compras++; atual.total += v.total;
      if (!atual.ultima || v.data > atual.ultima) atual.ultima = v.data;
      porCliente.set(v.clienteId, atual);
    }

    const termo = busca.value.trim().toLowerCase();
    const lista = clientes
      .filter(c => !termo || c.nome.toLowerCase().includes(termo) ||
        String(c.telefone || '').includes(termo) || (c.cidade || '').toLowerCase().includes(termo))
      .sort((a, b) => (porCliente.get(b.id)?.total || 0) - (porCliente.get(a.id)?.total || 0));

anexar(limpar(corpo), 
      el('div', { class: 'grade2 mb' }, [
        kpi({ rot: 'Clientes', val: numero(clientes.length) }),
        kpi({ rot: 'Com WhatsApp', val: numero(clientes.filter(c => c.telefone).length), det: 'dá para chamar', cor: 'verde' })
      ]),
      lista.length
        ? el('div', { class: 'cartao' }, el('div', { class: 'lista' }, lista.map(c => {
            const r = porCliente.get(c.id);
            return el('button', { class: 'item', onclick: () => abrir(c, r, vendas) }, [
              el('div', { class: 'info' }, [
                el('div', { class: 'titulo', text: c.nome }),
                el('div', { class: 'sub', text: [telefoneBR(c.telefone), c.cidade, r ? `${r.compras} compra(s)` : null].filter(Boolean).join(' · ') || 'sem contato' })
              ]),
              r ? el('span', { class: 'valor', text: dinheiro(r.total) }) : el('span', { class: 'pq mudo', text: '—' })
            ]);
          })))
        : vazio('Nenhum cliente cadastrado', '👥')
    );
  }

  function abrir(cliente, resumo, vendas) {
    const compras = vendas.filter(v => v.clienteId === cliente.id && !v.cancelada)
      .sort((a, b) => String(b.data).localeCompare(String(a.data)));
    const zap = numeroWhatsApp(cliente.telefone);

    painel({
      titulo: cliente.nome,
      corpo: el('div', {}, [
        el('div', { class: 'grade2 mb' }, [
          kpi({ rot: 'Compras', val: numero(resumo?.compras || 0) }),
          kpi({ rot: 'Total gasto', val: dinheiro(resumo?.total || 0), cor: 'verde' })
        ]),
        el('div', { class: 'pq mudo mb', text:
          [telefoneBR(cliente.telefone), cliente.cidade, cliente.endereco, cliente.email, cliente.doc]
            .filter(Boolean).join(' · ') || 'Sem contato cadastrado' }),
        cliente.obs ? el('div', { class: 'aviso aviso-amarelo', text: cliente.obs }) : null,
        compras.length
          ? el('div', { class: 'cartao' }, el('div', { class: 'lista rolagem' }, compras.slice(0, 40).map(v =>
              el('div', { class: 'item' }, [
                el('div', { class: 'info' }, [
                  el('div', { class: 'titulo', text: v.codigo }),
                  el('div', { class: 'sub', text: dataBR(v.data) })
                ]),
                el('span', { class: 'valor', text: dinheiro(v.total) })
              ]))))
          : vazio('Ainda não comprou', '🧾')
      ]),
      acoes: [
        { rotulo: 'Editar', acao: (f) => { f(); formulario(cliente); } },
        zap ? { rotulo: '💬 WhatsApp', class: 'btn-ok',
                acao: () => abrirWhatsApp(zap, `Olá ${cliente.nome.split(' ')[0]}! Aqui é da Loja das Argamassas.`) } : null
      ].filter(Boolean)
    });
  }

  function formulario(cliente = null) {
    const nome = el('input', { type: 'text', value: cliente?.nome || '' });
    const telefone = el('input', { type: 'tel', value: cliente?.telefone || '', placeholder: '(81) 90000-0000' });
    const cidade = el('input', { type: 'text', value: cliente?.cidade || '' });
    const endereco = el('input', { type: 'text', value: cliente?.endereco || '' });
    const email = el('input', { type: 'email', value: cliente?.email || '' });
    const doc = el('input', { type: 'text', value: cliente?.doc || '', placeholder: 'CPF ou CNPJ' });
    const obs = el('textarea', { placeholder: 'Observações, obra em andamento, condições…' });
    obs.value = cliente?.obs || '';
    const statusFala = el('div', { class: 'voz-status' });
    const btnFala = el('button', { class: 'btn btn-voz btn-bloco', type: 'button' }, '🎤 Ditar os dados');
    let rec = null;

    btnFala.onclick = () => {
      if (!vozDisponivel()) { erro('Este navegador não reconhece voz. Use o Chrome.'); return; }
      if (rec?.ativo) { rec.parar(); return; }
      rec = criarReconhecedor({
        continuo: false,
        onEstado: (s) => {
          btnFala.classList.toggle('ouvindo', s === 'ouvindo');
          btnFala.textContent = s === 'ouvindo' ? '⏹ Parar' : '🎤 Ditar os dados';
          if (s === 'ouvindo') statusFala.textContent = 'Ex.: "nome Maria Souza telefone 81 98888 7777"';
        },
        onErro: (m) => { statusFala.textContent = m; },
        onTexto: (texto, parcial) => {
          statusFala.textContent = `“${texto}”`;
          if (parcial) return;
          const d = interpretarCliente(texto);
          if (d.name) nome.value = d.name;
          if (d.phone) telefone.value = d.phone;
          statusFala.textContent = 'Preenchido. Confira antes de salvar.';
        }
      });
      rec.iniciar();
    };

    painel({
      titulo: cliente ? 'Editar cliente' : 'Novo cliente',
      corpo: el('div', {}, [
        btnFala, statusFala,
        el('div', { class: 'campo mt' }, [el('label', { text: 'Nome *' }), nome]),
        el('div', { class: 'campo' }, [el('label', { text: 'WhatsApp' }), telefone]),
        el('div', { class: 'campo' }, [el('label', { text: 'Cidade / bairro' }), cidade]),
        el('div', { class: 'campo' }, [el('label', { text: 'Endereço' }), endereco]),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'E-mail' }), email]),
          el('div', { class: 'campo' }, [el('label', { text: 'CPF / CNPJ' }), doc])
        ]),
        el('div', { class: 'campo' }, [el('label', { text: 'Observações' }), obs])
      ]),
      acoes: [
        cliente ? { rotulo: 'Excluir', class: 'btn-perigo', acao: async (fechar) => {
          if (!await confirmar(`Excluir ${cliente.nome}? As vendas continuam no histórico.`, { perigo: true })) return;
          await remover('clientes', cliente.id);
          sucesso('Cliente excluído'); fechar(); desenhar();
        } } : null,
        { rotulo: 'Salvar', class: 'btn-primario', acao: async (fechar) => {
          if (!nome.value.trim()) { erro('Informe o nome'); return; }
          rec?.parar();
          await salvar('clientes', {
            ...(cliente || { criadoEm: new Date().toISOString() }),
            nome: nome.value.trim(), telefone: telefone.value.trim(),
            cidade: cidade.value.trim(), endereco: endereco.value.trim(),
            email: email.value.trim(), doc: doc.value.trim(), obs: obs.value.trim()
          });
          sucesso(cliente ? 'Cliente atualizado' : 'Cliente cadastrado');
          fechar(); desenhar();
        } }
      ].filter(Boolean)
    });
  }

  desenhar();
}
