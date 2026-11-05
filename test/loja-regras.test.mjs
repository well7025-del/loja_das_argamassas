// Regras de preço, desconto, pagamento, comissão e livro de estoque do app da loja.
// Rodar: npm test
import assert from 'node:assert/strict';
import * as R from '../public/loja/js/regras.js';

const arg = { id: 1, nome: 'AC-III', unidade: 'SC', preco: 28, custo: 18, comissao: 3, comissaoTipo: 'percentual',
  descontos: [{ qtd: 50, percentual: 5 }, { qtd: 100, percentual: 10 }] };
const cim = { id: 2, nome: 'Cimento', unidade: 'SC', preco: 42, custo: 32, comissao: 0.5, comissaoTipo: 'valor', descontos: [] };

assert.equal(R.centavos(1.005), 1.01);
assert.equal(R.centavos(-1.005), -1.01);
assert.equal(R.centavos(0.1 + 0.2), 0.3);

// faixa de quantidade + desconto no item
let l = R.calcularLinha(arg, 120, { tipo: 'percentual', valor: 5 });
assert.equal(l.preco, 25.2); assert.equal(l.bruto, 3024); assert.equal(l.descontoItem, 151.2); assert.equal(l.total, 2872.8);
assert.equal(l.economiaQtd, 336);
l = R.calcularLinha(cim, 10, { tipo: 'valor', valor: 20 });
assert.equal(l.total, 400);
// desconto no item nunca passa da linha
assert.equal(R.calcularLinha(cim, 1, { tipo: 'valor', valor: 999 }).total, 0);
assert.equal(R.calcularLinha(cim, 1, null).descontoItem, 0);

const itens = [R.montarItem(arg, 120, { tipo: 'percentual', valor: 5 }), R.montarItem(cim, 10, { tipo: 'valor', valor: 20 })];
const t = R.totalizarVenda(itens, 72.8);
assert.equal(t.subtotal, 3272.8); assert.equal(t.desconto, 72.8); assert.equal(t.total, 3200);
assert.equal(t.descontoQuantidade, 336); assert.equal(t.descontoItens, 171.2);
assert.equal(t.descontoTotal, 336 + 171.2 + 72.8);
assert.equal(t.custo, 18 * 120 + 32 * 10);

// líquido por item: o desconto geral é rateado
const venda = { itens, ...t };
const liq1 = R.valorLiquidoItem(venda, itens[0]), liq2 = R.valorLiquidoItem(venda, itens[1]);
assert.ok(Math.abs(liq1 + liq2 - 3200) <= 0.01, `rateio fecha: ${liq1}+${liq2}`);
assert.equal(liq1, R.centavos(2872.8 * 3200 / 3272.8));

// comissão percentual sobre o líquido; por unidade não muda com desconto
assert.equal(R.comissaoDoItem(arg, itens[0], venda), R.centavos(liq1 * 0.03));
assert.ok(R.comissaoDoItem(arg, itens[0], venda) < R.centavos(3024 * 0.03));
assert.equal(R.comissaoDoItem(cim, itens[1], venda), 5);
// compatível com a chamada antiga (sem a venda)
assert.equal(R.comissaoDoItem(arg, itens[0]), R.centavos(2872.8 * 0.03));

// pagamentos
const antiga = { total: 280, pagamento: 'pix', contaId: 2, conciliada: true };
assert.deepEqual(R.pagamentosDe(antiga), [{ forma: 'pix', valor: 280, contaId: 2, conciliado: true }]);
assert.equal(R.descreverPagamento(antiga), 'PIX');
const pags = R.normalizarPagamentos([{ forma: 'pix', valor: 100 }, { forma: 'dinheiro', valor: 50 }, { forma: 'pix', valor: 30 }, { forma: 'debito', valor: 0 }]);
assert.deepEqual(pags, [{ forma: 'pix', valor: 130 }, { forma: 'dinheiro', valor: 50 }]);
assert.equal(R.formaResumo(pags), 'misto');
assert.equal(R.formaResumo([{ forma: 'pix', valor: 10 }]), 'pix');
assert.equal(R.validarPagamentos(pags, 180), null);
assert.match(R.validarPagamentos(pags, 200), /Faltam 20,00/);
assert.match(R.validarPagamentos(pags, 170), /passam do total em 10,00/);
assert.equal(R.descreverPagamento({ pagamentos: pags }, v => 'R$' + v), 'PIX R$130 + Dinheiro R$50');

// movimento de estoque
const movs = [
  { id: 1, produtoId: 1, data: '2026-01-01T00:00:00Z', tipo: 'abertura', qtd: 100 },
  { id: 2, produtoId: 1, data: '2026-02-10T10:00:00Z', tipo: 'entrada', qtd: 50 },
  { id: 3, produtoId: 1, data: '2026-03-05T10:00:00Z', tipo: 'venda', qtd: -30 },
  { id: 4, produtoId: 1, data: '2026-03-06T10:00:00Z', tipo: 'ajuste', qtd: -2 },
  { id: 5, produtoId: 1, data: '2026-03-20T10:00:00Z', tipo: 'cancelamento', qtd: 10 },
  { id: 6, produtoId: 1, data: '2026-04-01T10:00:00Z', tipo: 'venda', qtd: -40 },
  { id: 7, produtoId: 2, data: '2026-03-15T10:00:00Z', tipo: 'entrada', qtd: 5 }
];
const rel = R.movimentoPorProduto(movs, [arg, cim], '2026-03-01', '2026-03-31');
const a = rel.find(r => r.produtoId === 1);
assert.deepEqual([a.saldoInicial, a.entradas, a.saidas, a.saldoFinal], [150, 10, 32, 128]);
assert.deepEqual(a.porTipo, { venda: -30, ajuste: -2, cancelamento: 10 });
assert.equal(a.valorFinal, 128 * 18);
const c = rel.find(r => r.produtoId === 2);
assert.deepEqual([c.saldoInicial, c.entradas, c.saidas, c.saldoFinal], [0, 5, 0, 5]);
// o saldo final de um período é o inicial do seguinte
const abr = R.movimentoPorProduto(movs, [arg], '2026-04-01', '2026-04-30')[0];
assert.equal(abr.saldoInicial, a.saldoFinal);
assert.equal(abr.saldoFinal, 88);

const ficha = R.fichaDoProduto(movs, 1, '2026-03-01', '2026-03-31');
assert.equal(ficha.saldoInicial, 150);
assert.deepEqual(ficha.linhas.map(x => x.saldo), [120, 118, 128]);

assert.deepEqual(R.diferencaDeItens([{ produtoId: 1, qtd: 10 }, { produtoId: 2, qtd: 3 }], [{ produtoId: 1, qtd: 6 }, { produtoId: 3, qtd: 2 }]),
  [{ produtoId: 1, qtd: 4 }, { produtoId: 2, qtd: 3 }, { produtoId: 3, qtd: -2 }]);

console.log('regras.js: todos os testes passaram');
