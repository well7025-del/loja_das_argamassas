/* ============================================================
   Regras de negócio puras: preço, desconto, pagamento, comissão e
   movimento de estoque. Nada aqui toca o banco nem a tela — por isso
   dá para testar no Node e reaproveitar no PDV, na alteração de
   venda, nos relatórios e no comprovante sem cada um fazer a conta
   do seu jeito.
   ============================================================ */

/** Arredonda para centavos sem o erro clássico de 1,005 virar 1,00. */
export const centavos = (v) => {
  const n = Number(v) || 0;
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100 + 0;
};
const qtd3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

/* ---------------- Formas de pagamento ---------------- */

export const FORMAS_PAGAMENTO = [
  { id: 'dinheiro', rotulo: 'Dinheiro', icone: '💵' },
  { id: 'pix',      rotulo: 'PIX',      icone: '⚡' },
  { id: 'debito',   rotulo: 'Débito',   icone: '💳' },
  { id: 'credito',  rotulo: 'Crédito',  icone: '💳' }
];

// formas antigas continuam com nome: o histórico importado ainda as tem
const NOMES_FORMA = {
  dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito',
  prazo: 'A prazo', boleto: 'Boleto', outros: 'Outros', misto: 'Misto'
};
export const nomeForma = (forma) => NOMES_FORMA[forma] || String(forma || '—');

/**
 * Pagamentos de uma venda. Vendas da versão anterior têm uma forma só
 * (`pagamento`) e o total inteiro nela; aqui elas viram a mesma lista que as
 * vendas novas, para nenhum relatório precisar saber de qual versão a venda é.
 */
export function pagamentosDe(venda) {
  if (Array.isArray(venda?.pagamentos) && venda.pagamentos.length) return venda.pagamentos;
  return [{
    forma: venda?.pagamento || 'dinheiro',
    valor: centavos(venda?.total),
    contaId: venda?.contaId ?? null,
    conciliado: Boolean(venda?.conciliada)
  }];
}

/** `pagamento` da venda: a forma, ou "misto" quando há mais de uma. */
export function formaResumo(pagamentos) {
  const formas = [...new Set(pagamentos.filter(p => p.valor > 0).map(p => p.forma))];
  return formas.length === 1 ? formas[0] : (formas.length ? 'misto' : 'dinheiro');
}

/** "PIX" ou "PIX R$ 100,00 + Dinheiro R$ 50,00". */
export function descreverPagamento(venda, formatar = (v) => centavos(v).toFixed(2)) {
  const lista = pagamentosDe(venda).filter(p => p.valor > 0);
  if (lista.length <= 1) return nomeForma(lista[0]?.forma || venda?.pagamento);
  return lista.map(p => `${nomeForma(p.forma)} ${formatar(p.valor)}`).join(' + ');
}

/** Junta pagamentos repetidos da mesma forma e descarta os zerados. */
export function normalizarPagamentos(lista) {
  const porForma = new Map();
  for (const p of lista || []) {
    const valor = centavos(p.valor);
    if (!(valor > 0)) continue;
    porForma.set(p.forma, centavos((porForma.get(p.forma) || 0) + valor));
  }
  return [...porForma.entries()].map(([forma, valor]) => ({ forma, valor }));
}

/**
 * Confere se os pagamentos fecham com o total. Devolve a mensagem de erro, ou
 * null quando está tudo certo. Tolerância de 1 centavo pelo arredondamento.
 */
export function validarPagamentos(pagamentos, total) {
  if (!pagamentos.length) return 'Escolha a forma de pagamento';
  const soma = centavos(pagamentos.reduce((a, p) => a + p.valor, 0));
  const diferenca = centavos(total - soma);
  if (Math.abs(diferenca) > 0.01) {
    return diferenca > 0
      ? `Faltam ${diferenca.toFixed(2).replace('.', ',')} para fechar o total`
      : `Os pagamentos passam do total em ${(-diferenca).toFixed(2).replace('.', ',')}`;
  }
  return null;
}

/* ---------------- Preço e desconto ---------------- */

/**
 * Faixas de desconto cadastradas no produto, por exemplo
 * [{ qtd: 50, percentual: 5 }, { qtd: 100, percentual: 10 }].
 * Vale a maior faixa já atingida pela quantidade do pedido.
 */
export function descontoPorQuantidade(produto, qtd) {
  const faixas = (produto?.descontos || [])
    .filter(f => Number(f.qtd) > 0 && Number(f.percentual) > 0)
    .sort((a, b) => a.qtd - b.qtd);
  let pct = 0;
  for (const f of faixas) if (Number(qtd) >= Number(f.qtd)) pct = Number(f.percentual);
  return pct;
}

/** Preço unitário já com o desconto de quantidade aplicado. */
export function precoComDesconto(produto, qtd) {
  const pct = descontoPorQuantidade(produto, qtd);
  const preco = Number(produto?.preco) || 0;
  return { pct, preco: Number((preco * (1 - pct / 100)).toFixed(4)) };
}

/**
 * Valor em R$ de um desconto informado no item: `{ tipo: 'percentual', valor: 5 }`
 * (5% da linha) ou `{ tipo: 'valor', valor: 20 }` (R$ 20 na linha). Nunca passa
 * do valor da linha.
 */
export function valorDoDesconto(regra, base) {
  if (!regra || !(Number(regra.valor) > 0) || !(base > 0)) return 0;
  const bruto = regra.tipo === 'percentual' ? base * Number(regra.valor) / 100 : Number(regra.valor);
  return centavos(Math.min(base, Math.max(0, bruto)));
}

/**
 * Uma linha do pedido, com as duas camadas de desconto:
 * primeiro a faixa de quantidade do cadastro, depois o desconto que o
 * vendedor deu naquele item.
 */
export function calcularLinha(produto, qtd, regraDesconto = null) {
  const q = Number(qtd) || 0;
  const precoTabela = Number(produto?.preco) || 0;
  const { pct, preco } = precoComDesconto(produto, q);
  const bruto = centavos(preco * q);
  const descontoItem = valorDoDesconto(regraDesconto, bruto);
  return {
    precoTabela, pct, preco,
    bruto,
    descontoItem,
    total: centavos(bruto - descontoItem),
    economiaQtd: centavos((precoTabela - preco) * q)
  };
}

/** Item como é gravado na venda. */
export function montarItem(produto, qtd, regraDesconto = null) {
  const l = calcularLinha(produto, qtd, regraDesconto);
  return {
    produtoId: produto.id, nome: produto.nome, unidade: produto.unidade,
    qtd: Number(qtd), preco: centavos(l.preco), precoTabela: l.precoTabela,
    descontoQtd: l.pct,
    descontoItem: l.descontoItem,
    regraDesconto: l.descontoItem > 0 ? { tipo: regraDesconto.tipo, valor: Number(regraDesconto.valor) } : null,
    custo: Number(produto.custo) || 0,
    total: l.total
  };
}

/**
 * Totais da venda a partir dos itens já montados e do desconto geral do
 * pedido (R$). O desconto geral nunca passa do subtotal.
 */
export function totalizarVenda(itens, descontoPedido = 0) {
  const subtotal = centavos(itens.reduce((a, i) => a + (Number(i.total) || 0), 0));
  const descontoQuantidade = centavos(itens.reduce(
    (a, i) => a + ((Number(i.precoTabela) || Number(i.preco) || 0) - (Number(i.preco) || 0)) * (Number(i.qtd) || 0), 0));
  const descontoItens = centavos(itens.reduce((a, i) => a + (Number(i.descontoItem) || 0), 0));
  const desconto = centavos(Math.min(subtotal, Math.max(0, Number(descontoPedido) || 0)));
  const total = centavos(subtotal - desconto);
  const custo = centavos(itens.reduce((a, i) => a + (Number(i.custo) || 0) * (Number(i.qtd) || 0), 0));
  return {
    subtotal, descontoQuantidade, descontoItens, desconto, total, custo,
    lucro: centavos(total - custo),
    // o que o cliente deixou de pagar em relação à tabela, somando tudo
    descontoTotal: centavos(descontoQuantidade + descontoItens + desconto)
  };
}

/* ---------------- Valor líquido e comissão ---------------- */

/**
 * Quanto do total da venda corresponde a este item, depois de TODOS os
 * descontos. O desconto geral do pedido é rateado entre os itens na proporção
 * do valor de cada um — é a mesma conta que um auditor faria.
 */
export function valorLiquidoItem(venda, item) {
  const somaItens = (venda?.itens || []).reduce((a, i) => a + (Number(i.total) || 0), 0);
  const totalItem = Number(item?.total) || 0;
  if (!(somaItens > 0)) return 0;
  const fator = (Number(venda.total) || 0) / somaItens;
  return centavos(totalItem * Math.min(1, Math.max(0, fator)));
}

/**
 * Comissão devida por um item. A percentual incide sobre o valor líquido
 * (depois do desconto de quantidade, do desconto no item e da parte do
 * desconto geral); a por unidade não depende de preço, então não muda com
 * desconto.
 */
export function comissaoDoItem(produto, item, venda = null) {
  if (!produto?.comissao) return 0;
  const qtd = Number(item.qtd) || 0;
  if (produto.comissaoTipo === 'valor') return centavos(produto.comissao * qtd);
  const base = venda ? valorLiquidoItem(venda, item) : (Number(item.total) || 0);
  return centavos(base * produto.comissao / 100);
}

/* ---------------- Movimento de estoque ---------------- */

export const TIPOS_MOVIMENTO = {
  abertura: 'Saldo de abertura',
  entrada: 'Entrada de mercadoria',
  saida_manual: 'Saída manual',
  venda: 'Venda',
  cancelamento: 'Cancelamento de venda',
  alteracao: 'Alteração de venda',
  ajuste: 'Ajuste extraordinário',
  inventario: 'Acerto de inventário'
};

/**
 * Relatório de movimento por produto num período [de, ate] (datas AAAA-MM-DD,
 * inclusive). Saldo inicial é tudo o que aconteceu antes de `de`; o final é o
 * inicial mais as entradas e menos as saídas do período.
 */
export function movimentoPorProduto(movimentos, produtos, de, ate) {
  const linhas = new Map();
  for (const p of produtos) {
    linhas.set(p.id, {
      produtoId: p.id, nome: p.nome, unidade: p.unidade, custo: Number(p.custo) || 0,
      saldoInicial: 0, entradas: 0, saidas: 0, saldoFinal: 0,
      porTipo: {}, movimentos: 0
    });
  }
  for (const m of movimentos) {
    const linha = linhas.get(m.produtoId);
    if (!linha) continue;
    const dia = String(m.data).slice(0, 10);
    const q = Number(m.qtd) || 0;
    if (dia < de) { linha.saldoInicial += q; continue; }
    if (dia > ate) continue;
    if (q >= 0) linha.entradas += q; else linha.saidas += -q;
    linha.porTipo[m.tipo] = (linha.porTipo[m.tipo] || 0) + q;
    linha.movimentos++;
  }
  return [...linhas.values()].map(l => {
    l.saldoInicial = qtd3(l.saldoInicial);
    l.entradas = qtd3(l.entradas);
    l.saidas = qtd3(l.saidas);
    l.saldoFinal = qtd3(l.saldoInicial + l.entradas - l.saidas);
    for (const t of Object.keys(l.porTipo)) l.porTipo[t] = qtd3(l.porTipo[t]);
    l.valorFinal = centavos(l.saldoFinal * l.custo);
    return l;
  });
}

/** Ficha de um produto (kardex): cada movimento com o saldo depois dele. */
export function fichaDoProduto(movimentos, produtoId, de, ate) {
  const doProduto = movimentos
    .filter(m => m.produtoId === produtoId)
    .sort((a, b) => String(a.data).localeCompare(String(b.data)) || (a.id || 0) - (b.id || 0));
  let saldo = 0;
  const linhas = [];
  for (const m of doProduto) {
    const dia = String(m.data).slice(0, 10);
    if (dia > ate) break;
    saldo = qtd3(saldo + (Number(m.qtd) || 0));
    if (dia >= de) linhas.push({ ...m, saldo });
  }
  const saldoInicial = qtd3(doProduto
    .filter(m => String(m.data).slice(0, 10) < de)
    .reduce((a, m) => a + (Number(m.qtd) || 0), 0));
  return { saldoInicial, linhas };
}

/**
 * Diferença de quantidade por produto entre dois conjuntos de itens — o que
 * uma alteração de venda realmente moveu no estoque. Positivo voltou para a
 * prateleira; negativo saiu a mais.
 */
export function diferencaDeItens(antigos, novos) {
  const saldo = new Map();
  for (const i of antigos || []) if (i.produtoId != null) saldo.set(i.produtoId, (saldo.get(i.produtoId) || 0) + (Number(i.qtd) || 0));
  for (const i of novos || []) if (i.produtoId != null) saldo.set(i.produtoId, (saldo.get(i.produtoId) || 0) - (Number(i.qtd) || 0));
  return [...saldo.entries()].map(([produtoId, q]) => ({ produtoId, qtd: qtd3(q) })).filter(d => d.qtd !== 0);
}
