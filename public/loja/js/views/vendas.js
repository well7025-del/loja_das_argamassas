/* Histórico de vendas: consulta, comprovante e reenvio do recibo. */
import { listar, porIndice, cancelarVenda, obter } from '../db.js';
import { estado } from '../app.js';
import {
  el, limpar, dinheiro, numero, dataHora, dataBR, erro, sucesso, painel, vazio,
  abrirWhatsApp, numeroWhatsApp, copiar, confirmar, atrasar, diasAtras, hoje, kpi, anexar } from '../ui.js';
import { impressoraDisponivel, imprimirCupom } from '../impressora.js';

const PAGAMENTO = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito', prazo: 'A prazo', boleto: 'Boleto' };

export async function render(raiz) {
  const corpo = el('div');
  const de = el('input', { type: 'date', value: diasAtras(29) });
  const ate = el('input', { type: 'date', value: hoje() });
  const busca = el('input', { type: 'search', placeholder: 'Código da venda ou cliente…' });
  [de, ate].forEach(c => c.addEventListener('change', desenhar));
  busca.addEventListener('input', atrasar(desenhar, 250));

  raiz.append(
    el('div', { class: 'linha mb' }, [
      el('div', { class: 'campo', style: { margin: 0 } }, [el('label', { text: 'De' }), de]),
      el('div', { class: 'campo', style: { margin: 0 } }, [el('label', { text: 'Até' }), ate])
    ]),
    el('div', { class: 'campo' }, [busca]),
    corpo
  );

  async function desenhar() {
    const todas = await listar('vendas');
    const termo = busca.value.trim().toLowerCase();
    const lista = todas
      .filter(v => {
        const dia = String(v.data).slice(0, 10);
        return dia >= de.value && dia <= ate.value &&
          (!termo || v.codigo.toLowerCase().includes(termo) || (v.clienteNome || '').toLowerCase().includes(termo));
      })
      .sort((a, b) => String(b.data).localeCompare(String(a.data)));

    const validas = lista.filter(v => !v.cancelada);
    const total = validas.reduce((a, v) => a + v.total, 0);

anexar(limpar(corpo), 
      el('div', { class: 'grade2 mb' }, [
        kpi({ rot: 'Faturamento', val: dinheiro(total), det: `${numero(validas.length)} venda(s)`, cor: 'verde' }),
        kpi({ rot: 'Ticket médio', val: dinheiro(validas.length ? total / validas.length : 0), cor: 'amarelo' })
      ]),
      lista.length
        ? el('div', { class: 'cartao' }, el('div', { class: 'lista' }, lista.slice(0, 200).map(v =>
            el('button', { class: 'item', onclick: () => abrir(v) }, [
              el('div', { class: 'info' }, [
                el('div', { class: 'titulo' }, [
                  el('span', { text: v.codigo }),
                  v.temComprovante ? el('span', { text: ' 📎' }) : null,
                  v.cancelada ? el('span', { class: 'etiqueta et-vermelha', style: { marginLeft: '6px' }, text: 'cancelada' }) : null
                ]),
                el('div', { class: 'sub', text: `${dataHora(v.data)} · ${v.clienteNome || 'sem cliente'} · ${PAGAMENTO[v.pagamento] || v.pagamento}` })
              ]),
              el('span', { class: 'valor', style: v.cancelada ? { textDecoration: 'line-through', color: 'var(--cinza-500)' } : {}, text: dinheiro(v.total) })
            ]))))
        : vazio('Nenhuma venda no período', '🧾')
    );
  }

  function textoRecibo(venda) {
    const loja = estado.loja || {};
    return [
      `*${loja.nome || 'Loja das Argamassas — Caruaru'}*`, loja.telefone || null, '',
      `*Comprovante de venda ${venda.codigo}*`, `Data: ${dataHora(venda.data)}`,
      venda.clienteNome ? `Cliente: ${venda.clienteNome}` : null, '',
      ...venda.itens.map(i => `• ${numero(i.qtd)}x ${i.nome} — ${dinheiro(i.total)}`), '',
      venda.desconto > 0 ? `Desconto: -${dinheiro(venda.desconto)}` : null,
      `*Total: ${dinheiro(venda.total)}*`,
      `Pagamento: ${venda.pagamento.toUpperCase()}`, '', 'Obrigado pela preferência!'
    ].filter(l => l !== null).join('\n');
  }

  async function abrir(venda) {
    const comprovantes = await porIndice('comprovantes', 'vendaId', IDBKeyRange.only(venda.id));
    const foto = comprovantes[0]?.imagem;
    const texto = textoRecibo(venda);
    const zap = numeroWhatsApp(venda.clienteTelefone);

    painel({
      titulo: `Venda ${venda.codigo}`,
      corpo: el('div', {}, [
        venda.cancelada ? el('div', { class: 'aviso aviso-vermelho', text: 'Esta venda foi cancelada.' }) : null,
        el('div', { class: 'cartao mb' }, el('div', { class: 'lista' }, venda.itens.map(i =>
          el('div', { class: 'item' }, [
            el('div', { class: 'info' }, [
              el('div', { class: 'titulo', text: i.nome }),
              el('div', { class: 'sub', text: `${numero(i.qtd)} ${i.unidade} × ${dinheiro(i.preco)}` })
            ]),
            el('span', { class: 'valor', text: dinheiro(i.total) })
          ])))),
        venda.desconto > 0
          ? el('div', { class: 'total-linha' }, [el('span', { text: 'Desconto' }), el('span', { text: `− ${dinheiro(venda.desconto)}` })])
          : null,
        el('div', { class: 'total-linha grande' }, [el('span', { text: 'Total' }), el('span', { text: dinheiro(venda.total) })]),
        el('div', { class: 'aviso aviso-azul mt', text: `Custo ${dinheiro(venda.custo || 0)} · lucro ${dinheiro(venda.lucro || 0)}` }),
        venda.observacao ? el('div', { class: 'aviso aviso-amarelo', text: `Obs.: ${venda.observacao}` }) : null,
        foto ? el('div', { class: 'mt' }, [
          el('div', { class: 'pq negrito mb', text: 'Comprovante de pagamento' }),
          el('img', { src: foto, class: 'previa' })
        ]) : null
      ]),
      acoes: [
        impressoraDisponivel() && !venda.cancelada
          ? { rotulo: '🖨️', acao: async () => {
              try { sucesso(await imprimirCupom(venda)); } catch (e) { erro(e.message); }
            } }
          : null,
        !venda.cancelada ? { rotulo: 'Cancelar venda', class: 'btn-perigo', acao: async (fechar) => {
          if (!await confirmar('Cancelar esta venda? O estoque volta e o caixa é estornado.', { perigo: true })) return;
          try { await cancelarVenda(venda.id); sucesso('Venda cancelada'); fechar(); desenhar(); }
          catch (e) { erro(e.message); }
        } } : null,
        { rotulo: '💬 Reenviar', class: 'btn-ok', acao: () => abrirWhatsApp(zap, texto) }
      ].filter(Boolean)
    });
  }

  desenhar();
}
