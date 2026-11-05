/* ============================================================
   Banco local do aplicativo (IndexedDB).
   Todos os dados ficam no proprio celular — o app funciona sem internet.
   ============================================================ */
import {
  pagamentosDe, normalizarPagamentos, validarPagamentos, formaResumo, nomeForma,
  totalizarVenda, diferencaDeItens, descreverPagamento
} from './regras.js';

// mantidas aqui para quem já importava de db.js
export { descontoPorQuantidade, precoComDesconto, comissaoDoItem } from './regras.js';

const NOME_BANCO = 'argamassas-loja';
const VERSAO = 4;

/** Versão do formato dos dados (vendas com vários pagamentos e livro de estoque). */
export const ESQUEMA_DADOS = 4;

/**
 * Coleções do banco. `comprovantes` fica separado para o backup poder excluir
 * as fotos. `estoqueMov` é o livro de estoque: cada entrada e saída, com data —
 * é dele que sai o relatório de movimento por período.
 */
export const COLECOES = ['produtos', 'clientes', 'vendas', 'despesas', 'contas', 'lancamentos',
                         'comprovantes', 'documentos', 'ajustes', 'inventarios', 'extratos',
                         'estoqueMov', 'config'];

/** Coleções que guardam apenas cadastro — o backup "só cadastros" leva estas. */
export const COLECOES_CADASTRO = ['produtos', 'clientes', 'contas', 'config'];

/**
 * Contas criadas na primeira abertura. `chave` identifica a conta mesmo que o
 * dono renomeie, e `recebe` diz quais formas de pagamento caem nela.
 */
export const CONTAS_PADRAO = [
  { chave: 'caixa',   nome: 'Caixa da loja', tipo: 'dinheiro', recebe: ['dinheiro'],            ordem: 1, saldoInicial: 0, ativa: true },
  { chave: 'pix',     nome: 'Conta PIX',     tipo: 'banco',    recebe: ['pix'],                 ordem: 2, saldoInicial: 0, ativa: true },
  { chave: 'cartoes', nome: 'Conta Cartões', tipo: 'banco',    recebe: ['debito', 'credito'],   ordem: 3, saldoInicial: 0, ativa: true }
];

let bancoPromise = null;

function abrir() {
  if (bancoPromise) return bancoPromise;
  bancoPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(NOME_BANCO, VERSAO);
    req.onupgradeneeded = (evento) => {
      const bd = req.result;
      const tx = req.transaction;
      const anterior = evento.oldVersion;

      for (const nome of COLECOES) {
        if (bd.objectStoreNames.contains(nome)) continue;
        const store = nome === 'config'
          ? bd.createObjectStore(nome, { keyPath: 'chave' })
          : bd.createObjectStore(nome, { keyPath: 'id', autoIncrement: true });
        if (nome === 'vendas') { store.createIndex('data', 'data'); store.createIndex('clienteId', 'clienteId'); }
        if (nome === 'despesas') store.createIndex('data', 'data');
        if (nome === 'lancamentos') { store.createIndex('data', 'data'); store.createIndex('contaId', 'contaId'); }
        if (nome === 'comprovantes') store.createIndex('vendaId', 'vendaId');
        if (nome === 'produtos') store.createIndex('nome', 'nome');
        if (nome === 'documentos') store.createIndex('referencia', ['refTipo', 'refId']);
        if (nome === 'ajustes') { store.createIndex('data', 'data'); store.createIndex('produtoId', 'produtoId'); }
        if (nome === 'inventarios') store.createIndex('data', 'data');
        if (nome === 'extratos') store.createIndex('data', 'importadoEm');
        if (nome === 'estoqueMov') { store.createIndex('produtoId', 'produtoId'); store.createIndex('data', 'data'); }
      }

      // Banco novo: cria as contas padrão.
      // Vindo da v1: o caixa único vira uma conta entre outras (PIX e cartões),
      // e os lançamentos antigos são preservados na conta "Caixa da loja".
      if (anterior < 2) semearContas(bd, tx, anterior >= 1);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Não foi possível abrir o banco local'));
  });
  return bancoPromise;
}

/**
 * Cria as contas padrão e, quando vem da versão 1, move o antigo `caixa`
 * para `lancamentos`. Roda dentro da transação de upgrade, onde nada pode
 * ser assíncrono — por isso o encadeamento por onsuccess.
 */
function semearContas(bd, tx, migrarCaixa) {
  const contas = tx.objectStore('contas');
  for (const conta of CONTAS_PADRAO) {
    const pedidoConta = contas.add({ ...conta, criadaEm: new Date().toISOString() });
    pedidoConta.onsuccess = () => {
      // assim que a conta Caixa existir, transfere o histórico para ela
      if (!migrarCaixa || conta.chave !== 'caixa' || !bd.objectStoreNames.contains('caixa')) return;
      const lancamentos = tx.objectStore('lancamentos');
      const antigos = tx.objectStore('caixa').openCursor();
      antigos.onsuccess = () => {
        const cursor = antigos.result;
        if (!cursor) return;
        const m = cursor.value;
        lancamentos.add({
          contaId: pedidoConta.result, data: m.data, tipo: m.tipo, valor: m.valor,
          descricao: m.descricao || '', refTipo: m.refTipo || null, refId: m.refId ?? null,
          categoria: m.categoria || null
        });
        cursor.continue();
      };
    };
  }
}

function transacao(colecoes, modo, tarefa) {
  return abrir().then(bd => new Promise((resolve, reject) => {
    const tx = bd.transaction(colecoes, modo);
    let resultado;
    tx.oncomplete = () => resolve(resultado);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Operação cancelada'));
    Promise.resolve(tarefa(tx)).then(r => { resultado = r; }).catch(e => { try { tx.abort(); } catch {} reject(e); });
  }));
}

const pedido = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/* ---------------- Operações básicas ---------------- */
export const listar = (colecao) => transacao([colecao], 'readonly', tx => pedido(tx.objectStore(colecao).getAll()));
export const obter = (colecao, id) => transacao([colecao], 'readonly', tx => pedido(tx.objectStore(colecao).get(id)));
export const salvar = (colecao, registro) => transacao([colecao], 'readwrite', tx => pedido(tx.objectStore(colecao).put(registro)));
export const remover = (colecao, id) => transacao([colecao], 'readwrite', tx => pedido(tx.objectStore(colecao).delete(id)));
export const limpar = (colecao) => transacao([colecao], 'readwrite', tx => pedido(tx.objectStore(colecao).clear()));

export const porIndice = (colecao, indice, intervalo) =>
  transacao([colecao], 'readonly', tx => pedido(tx.objectStore(colecao).index(indice).getAll(intervalo)));

/* ---------------- Configuração ---------------- */
export async function config(chave, padrao = null) {
  const r = await obter('config', chave);
  return r === undefined ? padrao : r.valor;
}
export const definirConfig = (chave, valor) => salvar('config', { chave, valor });

/* ---------------- Contas ---------------- */

/** Contas ativas, na ordem em que aparecem na tela. */
export async function contasAtivas() {
  const contas = await listar('contas');
  return contas.filter(c => c.ativa !== false).sort((a, b) => (a.ordem || 99) - (b.ordem || 99));
}

/** Saldo de uma conta = saldo inicial + soma dos lançamentos. */
export async function saldos() {
  const [contas, lancamentos] = await Promise.all([listar('contas'), listar('lancamentos')]);
  const soma = new Map();
  for (const l of lancamentos) soma.set(l.contaId, (soma.get(l.contaId) || 0) + l.valor);
  return contas
    .filter(c => c.ativa !== false)
    .sort((a, b) => (a.ordem || 99) - (b.ordem || 99))
    .map(c => ({ ...c, saldo: Number(((c.saldoInicial || 0) + (soma.get(c.id) || 0)).toFixed(2)) }));
}

export async function saldoConta(contaId) {
  const lista = await saldos();
  return lista.find(c => c.id === contaId)?.saldo ?? 0;
}

/** Conta de dinheiro — usada como padrão quando nada mais se aplica. */
export async function contaDinheiro() {
  const contas = await contasAtivas();
  return contas.find(c => c.chave === 'caixa') || contas.find(c => c.tipo === 'dinheiro') || contas[0] || null;
}

/** Descobre em qual conta cai uma venda, pela forma de pagamento. */
function acharConta(contas, pagamento) {
  return contas.find(c => c.ativa !== false && (c.recebe || []).includes(pagamento)) || null;
}

/** Lança uma receita ou despesa avulsa numa conta. */
export function lancar({ contaId, tipo, valor, descricao, categoria = null, data = null,
                         documento = false, refTipo = null, refId = null }) {
  return transacao(['lancamentos'], 'readwrite', tx => pedido(tx.objectStore('lancamentos').add({
    contaId, tipo, valor, descricao: descricao || '', categoria,
    temDocumento: Boolean(documento), refTipo, refId,
    data: data || new Date().toISOString()
  })));
}

/** Transferência entre contas: sai de uma e entra na outra, na mesma operação. */
export function transferir({ origemId, destinoId, valor, descricao = '', data = null, documento = false }) {
  if (origemId === destinoId) throw new Error('Escolha duas contas diferentes');
  if (!(valor > 0)) throw new Error('Informe um valor maior que zero');
  return transacao(['lancamentos', 'contas'], 'readwrite', async (tx) => {
    const loja = tx.objectStore('lancamentos');
    const contas = tx.objectStore('contas');
    const origem = await pedido(contas.get(origemId));
    const destino = await pedido(contas.get(destinoId));
    if (!origem || !destino) throw new Error('Conta não encontrada');

    const quando = data || new Date().toISOString();
    const marca = `T${Date.now()}`;
    await pedido(loja.add({ contaId: origemId, tipo: 'transferencia_saida', valor: -valor,
      descricao: descricao || `Transferência para ${destino.nome}`, transferencia: marca,
      temDocumento: Boolean(documento), data: quando }));
    await pedido(loja.add({ contaId: destinoId, tipo: 'transferencia_entrada', valor,
      descricao: descricao || `Transferência de ${origem.nome}`, transferencia: marca,
      temDocumento: Boolean(documento), data: quando }));
    return marca;
  });
}

/* ---------------- Operações compostas ---------------- */

/* ---------------- Livro de estoque ---------------- */

/**
 * Grava um movimento no livro de estoque, dentro da transação de quem mexeu
 * no saldo — se a operação desfaz, o movimento desfaz junto.
 */
function registrarMovimento(tx, { produtoId, qtd, tipo, data = null, refTipo = null, refId = null,
                                  obs = '', saldo = null, motivo = null }) {
  const q = Number(Number(qtd).toFixed(3));
  if (!q) return Promise.resolve(null);
  return pedido(tx.objectStore('estoqueMov').add({
    produtoId, qtd: q, tipo, data: data || new Date().toISOString(),
    refTipo, refId, obs: obs || '', saldo, motivo
  }));
}

/* ---------------- Operações compostas ---------------- */

/** Lançamentos de uma venda nas contas, um por forma de pagamento. */
async function lancarPagamentos(tx, venda, vendaId, sufixo = '') {
  const varios = venda.pagamentos.filter(p => p.contaId).length > 1;
  for (const p of venda.pagamentos) {
    if (!p.contaId || !(p.valor > 0)) continue;
    await pedido(tx.objectStore('lancamentos').add({
      contaId: p.contaId, data: venda.data, tipo: 'venda', valor: p.valor, forma: p.forma,
      descricao: `Venda ${venda.codigo}${varios ? ` (${nomeForma(p.forma)})` : ''}${sufixo}`,
      refTipo: 'venda', refId: vendaId
    }));
  }
}

/** Liga cada pagamento à conta que recebe aquela forma. */
function distribuirPagamentos(contas, pagamentos, total) {
  let lista = normalizarPagamentos(pagamentos);
  if (!(total > 0)) lista = [{ forma: pagamentos?.[0]?.forma || 'dinheiro', valor: 0 }];
  else {
    const problema = validarPagamentos(lista, total);
    if (problema) throw new Error(problema);
  }
  return lista.map(p => ({ ...p, contaId: acharConta(contas, p.forma)?.id ?? null, conciliado: false }));
}

/**
 * Registra uma venda: grava a venda, baixa o estoque de cada item, escreve o
 * livro de estoque e lança cada pagamento na conta da sua forma — tudo numa
 * única transação, para nunca ficar pela metade.
 *
 * `venda.pagamentos` é a lista [{ forma, valor }]; uma venda com
 * `pagamento` (texto) e sem a lista é tratada como paga inteira nessa forma.
 */
export function registrarVenda(venda, comprovante = null) {
  return transacao(['vendas', 'produtos', 'lancamentos', 'contas', 'comprovantes', 'estoqueMov'], 'readwrite', async (tx) => {
    const contas = await pedido(tx.objectStore('contas').getAll());
    const informados = venda.pagamentos?.length ? venda.pagamentos : [{ forma: venda.pagamento, valor: venda.total }];
    venda.pagamentos = distribuirPagamentos(contas, informados, venda.total);
    venda.pagamento = formaResumo(venda.pagamentos);
    venda.contaId = venda.pagamentos.length === 1 ? venda.pagamentos[0].contaId : null;

    const lojaProdutos = tx.objectStore('produtos');
    const saldos = new Map();
    for (const item of venda.itens) {
      const p = await pedido(lojaProdutos.get(item.produtoId));
      if (!p) throw new Error('Produto do pedido não foi encontrado');
      if (p.estoque < item.qtd) throw new Error(`Estoque insuficiente de ${p.nome}: há ${p.estoque} ${p.unidade}`);
      p.estoque = Number((p.estoque - item.qtd).toFixed(3));
      saldos.set(item.produtoId, p.estoque);
      await pedido(lojaProdutos.put(p));
    }

    const vendaId = await pedido(tx.objectStore('vendas').add(venda));

    for (const item of venda.itens) {
      await registrarMovimento(tx, {
        produtoId: item.produtoId, qtd: -item.qtd, tipo: 'venda', data: venda.data,
        refTipo: 'venda', refId: vendaId, obs: `Venda ${venda.codigo}`, saldo: saldos.get(item.produtoId)
      });
    }
    if (comprovante) await pedido(tx.objectStore('comprovantes').add({ vendaId, imagem: comprovante }));
    await lancarPagamentos(tx, venda, vendaId);
    return vendaId;
  });
}

/**
 * Cancela uma venda: devolve o estoque e estorna, em cada conta, exatamente o
 * que a venda tinha colocado nela (uma venda dividida em PIX e dinheiro
 * estorna nas duas).
 */
export function cancelarVenda(vendaId) {
  return transacao(['vendas', 'produtos', 'lancamentos', 'estoqueMov'], 'readwrite', async (tx) => {
    const venda = await pedido(tx.objectStore('vendas').get(vendaId));
    if (!venda) throw new Error('Venda não encontrada');
    if (venda.cancelada) throw new Error('Esta venda já foi cancelada');
    const agora = new Date().toISOString();

    const lojaProdutos = tx.objectStore('produtos');
    for (const item of venda.itens) {
      const p = await pedido(lojaProdutos.get(item.produtoId));
      if (!p) continue;
      p.estoque = Number((p.estoque + item.qtd).toFixed(3));
      await pedido(lojaProdutos.put(p));
      await registrarMovimento(tx, {
        produtoId: item.produtoId, qtd: item.qtd, tipo: 'cancelamento', data: agora,
        refTipo: 'venda', refId: vendaId, obs: `Cancelamento da venda ${venda.codigo}`, saldo: p.estoque
      });
    }

    const lancamentos = tx.objectStore('lancamentos');
    const daVenda = (await pedido(lancamentos.getAll()))
      .filter(l => l.refTipo === 'venda' && l.refId === vendaId);
    const porConta = new Map();
    for (const l of daVenda) porConta.set(l.contaId, (porConta.get(l.contaId) || 0) + l.valor);
    for (const [contaId, valor] of porConta) {
      const v = Number(valor.toFixed(2));
      if (!(v > 0)) continue;
      await pedido(lancamentos.add({
        contaId, data: agora, tipo: 'estorno', valor: -v,
        descricao: `Estorno da venda ${venda.codigo}`, refTipo: 'venda', refId: vendaId
      }));
    }
    venda.cancelada = true;
    venda.canceladaEm = agora;
    await pedido(tx.objectStore('vendas').put(venda));
  });
}

/** Lança uma despesa e debita a conta escolhida. */
export function registrarDespesa(despesa) {
  return transacao(['despesas', 'lancamentos'], 'readwrite', async (tx) => {
    const id = await pedido(tx.objectStore('despesas').add(despesa));
    if (despesa.contaId) {
      await pedido(tx.objectStore('lancamentos').add({
        contaId: despesa.contaId, data: despesa.data, tipo: 'despesa', valor: -despesa.valor,
        descricao: despesa.descricao || despesa.categoria, categoria: despesa.categoria,
        refTipo: 'despesa', refId: id
      }));
    }
    return id;
  });
}

/**
 * Entrada de mercadoria com custo real.
 *
 * O custo do produto passa a ser a média ponderada entre o que já estava em
 * estoque e o que acabou de chegar — é isso que faz o lucro do relatório
 * acompanhar o reajuste do fornecedor em vez de ficar preso no preço antigo.
 * Quando uma conta é informada, o pagamento ao fornecedor também é lançado.
 */
export function entradaEstoque(produtoId, quantidade, opcoes = {}) {
  const { custoUnitario = null, fornecedor = '', observacao = '', contaId = null, data = null } = opcoes;
  return transacao(['produtos', 'despesas', 'lancamentos', 'estoqueMov'], 'readwrite', async (tx) => {
    const loja = tx.objectStore('produtos');
    const p = await pedido(loja.get(produtoId));
    if (!p) throw new Error('Produto não encontrado');

    const novo = Number((p.estoque + quantidade).toFixed(3));
    if (novo < 0) throw new Error(`A saída deixaria o estoque negativo (há ${p.estoque} ${p.unidade})`);

    const custoAnterior = p.custo || 0;
    let custoAplicado = custoAnterior;

    if (quantidade > 0 && custoUnitario !== null && custoUnitario >= 0) {
      const saldoAnterior = Math.max(0, p.estoque);
      const valorAnterior = saldoAnterior * custoAnterior;
      const valorNovo = quantidade * custoUnitario;
      custoAplicado = novo > 0 ? Number(((valorAnterior + valorNovo) / (saldoAnterior + quantidade)).toFixed(4)) : custoUnitario;
      p.custo = custoAplicado;
    }

    p.estoque = novo;
    p.movimentos = [...(p.movimentos || []).slice(-49), {
      data: data || new Date().toISOString(), qtd: quantidade, obs: observacao, saldo: novo,
      custoUnitario: quantidade > 0 ? custoUnitario : null,
      custoMedio: custoAplicado, fornecedor: fornecedor || null
    }];
    await pedido(loja.put(p));
    await registrarMovimento(tx, {
      produtoId, qtd: quantidade, tipo: quantidade > 0 ? 'entrada' : 'saida_manual',
      data: data || new Date().toISOString(), saldo: novo,
      obs: [fornecedor, observacao].filter(Boolean).join(' — ')
    });

    // pagamento ao fornecedor
    let total = 0;
    if (contaId && quantidade > 0 && custoUnitario) {
      total = Number((quantidade * custoUnitario).toFixed(2));
      const despesa = {
        data: data || new Date().toISOString(), categoria: 'fornecedor', valor: total,
        descricao: `${quantidade} ${p.unidade} de ${p.nome}${fornecedor ? ' — ' + fornecedor : ''}`,
        forma: 'conta', contaId
      };
      const idDespesa = await pedido(tx.objectStore('despesas').add(despesa));
      await pedido(tx.objectStore('lancamentos').add({
        contaId, data: despesa.data, tipo: 'compra', valor: -total,
        descricao: despesa.descricao, categoria: 'fornecedor', refTipo: 'despesa', refId: idDespesa
      }));
    }

    return { saldo: novo, custoAnterior, custoMedio: custoAplicado, pago: total };
  });
}

/* ---------------- Documentos anexados ---------------- */

/**
 * Guarda a foto ou o PDF que autoriza um lançamento (ajuste de estoque,
 * mudança de preço, despesa, transferência). Sem isso a trilha de auditoria
 * fica só com a palavra de quem lançou.
 */
export async function anexarDocumento({ refTipo, refId, nome, imagem, observacao = '' }) {
  if (!imagem) return null;
  return salvar('documentos', {
    refTipo, refId, nome: nome || 'documento', imagem, observacao,
    criadoEm: new Date().toISOString()
  });
}

export const documentosDe = (refTipo, refId) =>
  porIndice('documentos', 'referencia', IDBKeyRange.only([refTipo, refId]));

/* ---------------- Ajustes extraordinários de estoque ---------------- */

export const MOTIVOS_AJUSTE = [
  { id: 'perda',      rotulo: 'Perda / avaria',      sinal: -1, exigeDoc: true },
  { id: 'devolucao',  rotulo: 'Devolução de cliente', sinal: +1, exigeDoc: false },
  { id: 'devolucao_fornecedor', rotulo: 'Devolução ao fornecedor', sinal: -1, exigeDoc: true },
  { id: 'inventario', rotulo: 'Acerto de inventário', sinal: 0,  exigeDoc: true },
  { id: 'balanco',    rotulo: 'Balanço',              sinal: 0,  exigeDoc: true },
  { id: 'bonificacao', rotulo: 'Bonificação recebida', sinal: +1, exigeDoc: false },
  { id: 'uso_interno', rotulo: 'Uso interno / amostra', sinal: -1, exigeDoc: false }
];

/**
 * Ajuste extraordinário: registra o antes e o depois, o motivo e o documento
 * que autoriza — é este registro que a auditoria lê, não o saldo atual.
 */
export function ajustarEstoque({ produtoId, motivo, quantidade, novoSaldo = null, observacao = '',
                                 documento = null, responsavel = '', data = null }) {
  return transacao(['produtos', 'ajustes', 'documentos', 'estoqueMov'], 'readwrite', async (tx) => {
    const loja = tx.objectStore('produtos');
    const p = await pedido(loja.get(produtoId));
    if (!p) throw new Error('Produto não encontrado');

    const antes = p.estoque;
    const depois = novoSaldo !== null ? Number(novoSaldo) : Number((antes + quantidade).toFixed(3));
    if (depois < 0) throw new Error(`O ajuste deixaria o estoque negativo (há ${antes} ${p.unidade})`);

    const diferenca = Number((depois - antes).toFixed(3));
    p.estoque = depois;
    p.movimentos = [...(p.movimentos || []).slice(-49), {
      data: data || new Date().toISOString(), qtd: diferenca, obs: `${motivo}${observacao ? ' — ' + observacao : ''}`,
      saldo: depois, custoMedio: p.custo || 0
    }];
    await pedido(loja.put(p));

    const registro = {
      produtoId, produtoNome: p.nome, unidade: p.unidade, motivo,
      antes, depois, diferenca,
      valorCusto: Number((diferenca * (p.custo || 0)).toFixed(2)),
      observacao, responsavel,
      data: data || new Date().toISOString()
    };
    const id = await pedido(tx.objectStore('ajustes').add(registro));
    await registrarMovimento(tx, {
      produtoId, qtd: diferenca, tipo: motivo === 'inventario' ? 'inventario' : 'ajuste', motivo,
      data: registro.data, refTipo: 'ajuste', refId: id, saldo: depois,
      obs: [observacao, responsavel && `por ${responsavel}`].filter(Boolean).join(' — ')
    });

    if (documento) {
      await pedido(tx.objectStore('documentos').add({
        refTipo: 'ajuste', refId: id, nome: `Autorização — ${motivo}`,
        imagem: documento, observacao, criadoEm: new Date().toISOString()
      }));
    }
    return { id, antes, depois, diferenca };
  });
}

/* ---------------- Alteração de preço com autorização ---------------- */

/** Troca o preço de venda guardando quem autorizou e o documento. */
export function alterarPreco({ produtoId, novoPreco, motivo = '', documento = null, responsavel = '' }) {
  return transacao(['produtos', 'ajustes', 'documentos'], 'readwrite', async (tx) => {
    const loja = tx.objectStore('produtos');
    const p = await pedido(loja.get(produtoId));
    if (!p) throw new Error('Produto não encontrado');

    const anterior = p.preco;
    p.preco = Number(novoPreco);
    p.historicoPreco = [...(p.historicoPreco || []).slice(-29), {
      data: new Date().toISOString(), de: anterior, para: p.preco, motivo, responsavel
    }];
    await pedido(loja.put(p));

    const id = await pedido(tx.objectStore('ajustes').add({
      produtoId, produtoNome: p.nome, motivo: 'preco',
      antes: anterior, depois: p.preco, diferenca: Number((p.preco - anterior).toFixed(2)),
      observacao: motivo, responsavel, data: new Date().toISOString()
    }));
    if (documento) {
      await pedido(tx.objectStore('documentos').add({
        refTipo: 'ajuste', refId: id, nome: 'Autorização — mudança de preço',
        imagem: documento, observacao: motivo, criadoEm: new Date().toISOString()
      }));
    }
    return { anterior, novo: p.preco };
  });
}

/* ---------------- Inventário ---------------- */

/**
 * Fecha um inventário: grava a contagem e aplica a diferença de cada produto
 * como ajuste, preservando o que foi contado x o que o sistema esperava.
 */
export function fecharInventario({ itens, observacao = '', responsavel = '', documento = null }) {
  return transacao(['produtos', 'inventarios', 'ajustes', 'documentos', 'estoqueMov'], 'readwrite', async (tx) => {
    const loja = tx.objectStore('produtos');
    const agora = new Date().toISOString();
    const linhas = [];

    for (const item of itens) {
      const p = await pedido(loja.get(item.produtoId));
      if (!p) continue;
      const esperado = p.estoque;
      const contado = Number(item.contado);
      const diferenca = Number((contado - esperado).toFixed(3));
      linhas.push({
        produtoId: p.id, nome: p.nome, unidade: p.unidade,
        esperado, contado, diferenca,
        custo: p.custo || 0, valorDiferenca: Number((diferenca * (p.custo || 0)).toFixed(2))
      });
      if (diferenca !== 0) {
        p.estoque = contado;
        p.movimentos = [...(p.movimentos || []).slice(-49), {
          data: agora, qtd: diferenca, obs: 'Inventário', saldo: contado, custoMedio: p.custo || 0
        }];
        await pedido(loja.put(p));
        const idAjuste = await pedido(tx.objectStore('ajustes').add({
          produtoId: p.id, produtoNome: p.nome, unidade: p.unidade, motivo: 'inventario',
          antes: esperado, depois: contado, diferenca,
          valorCusto: Number((diferenca * (p.custo || 0)).toFixed(2)),
          observacao, responsavel, data: agora
        }));
        await registrarMovimento(tx, {
          produtoId: p.id, qtd: diferenca, tipo: 'inventario', motivo: 'inventario', data: agora,
          refTipo: 'ajuste', refId: idAjuste, saldo: contado,
          obs: ['Contagem de inventário', responsavel && `por ${responsavel}`].filter(Boolean).join(' — ')
        });
      }
    }

    const resumo = {
      data: agora, responsavel, observacao,
      itens: linhas,
      produtosContados: linhas.length,
      divergencias: linhas.filter(l => l.diferenca !== 0).length,
      valorDivergencia: Number(linhas.reduce((a, l) => a + l.valorDiferenca, 0).toFixed(2))
    };
    const id = await pedido(tx.objectStore('inventarios').add(resumo));
    if (documento) {
      await pedido(tx.objectStore('documentos').add({
        refTipo: 'inventario', refId: id, nome: 'Documento do inventário',
        imagem: documento, observacao, criadoEm: agora
      }));
    }
    return { id, ...resumo };
  });
}

/* ---------------- Alteração de venda ---------------- */

/**
 * Altera uma venda já lançada: itens (quantidade, desconto, inclusão e
 * retirada), desconto geral, pagamentos, cliente e observação.
 *
 * O estoque recebe só a diferença entre os itens antigos e os novos, e ela vai
 * para o livro de estoque como "alteração de venda" na data de hoje — a venda
 * original continua lá, como aconteceu. Os lançamentos da venda nas contas são
 * refeitos pelos novos pagamentos.
 */
export function alterarVenda(vendaId, mudancas, motivo = '') {
  return transacao(['vendas', 'produtos', 'lancamentos', 'contas', 'estoqueMov'], 'readwrite', async (tx) => {
    const lojaVendas = tx.objectStore('vendas');
    const lojaProdutos = tx.objectStore('produtos');
    const venda = await pedido(lojaVendas.get(vendaId));
    if (!venda) throw new Error('Venda não encontrada');
    if (venda.cancelada) throw new Error('Venda cancelada não pode ser alterada');
    const agora = new Date().toISOString();

    const anterior = JSON.parse(JSON.stringify({
      itens: venda.itens, total: venda.total, desconto: venda.desconto || 0,
      pagamentos: pagamentosDe(venda), clienteId: venda.clienteId
    }));

    if (mudancas.itens) {
      if (!mudancas.itens.length) throw new Error('A venda precisa ter ao menos um item');
      for (const d of diferencaDeItens(venda.itens, mudancas.itens)) {
        const p = await pedido(lojaProdutos.get(d.produtoId));
        if (!p) { if (d.qtd < 0) throw new Error('Produto do pedido não encontrado'); continue; }
        const novo = Number((p.estoque + d.qtd).toFixed(3));
        if (novo < 0) throw new Error(`Estoque insuficiente de ${p.nome}: há ${p.estoque} ${p.unidade}`);
        p.estoque = novo;
        await pedido(lojaProdutos.put(p));
        await registrarMovimento(tx, {
          produtoId: d.produtoId, qtd: d.qtd, tipo: 'alteracao', data: agora,
          refTipo: 'venda', refId: vendaId, saldo: novo,
          obs: `Alteração da venda ${venda.codigo}${motivo ? ' — ' + motivo : ''}`
        });
      }
      venda.itens = mudancas.itens;
    }

    for (const campo of ['desconto', 'clienteId', 'clienteNome', 'clienteTelefone', 'observacao']) {
      if (mudancas[campo] !== undefined) venda[campo] = mudancas[campo];
    }

    // totais só são refeitos quando algo de valor mudou: identificar o cliente
    // de uma venda importada não pode reescrever o total que veio do sistema antigo
    const mexeuEmValor = Boolean(mudancas.itens) || mudancas.desconto !== undefined;
    if (mexeuEmValor) {
      const t = totalizarVenda(venda.itens, venda.desconto || 0);
      Object.assign(venda, {
        subtotal: t.subtotal, descontoQuantidade: t.descontoQuantidade, descontoItens: t.descontoItens,
        desconto: t.desconto, total: t.total, custo: t.custo, lucro: t.lucro
      });
    }

    // pagamentos: os informados, ou — numa venda de forma única — a mesma forma com o novo total
    let pagamentos = mudancas.pagamentos;
    if (!pagamentos && mexeuEmValor && Math.abs(venda.total - anterior.total) > 0.009) {
      if (anterior.pagamentos.length > 1) throw new Error('O total mudou: informe de novo como a venda foi paga');
      pagamentos = [{ forma: anterior.pagamentos[0].forma, valor: venda.total }];
    }
    const refazerFinanceiro = Boolean(pagamentos);
    if (refazerFinanceiro) {
      const contas = await pedido(tx.objectStore('contas').getAll());
      const novos = distribuirPagamentos(contas, pagamentos, venda.total);
      // o que não mudou continua conferido no extrato
      for (const p of novos) {
        const igual = anterior.pagamentos.find(a => a.forma === p.forma && Math.abs(a.valor - p.valor) < 0.005);
        if (igual?.conciliado) p.conciliado = true;
      }
      venda.pagamentos = novos;
      venda.pagamento = formaResumo(novos);
      venda.contaId = novos.length === 1 ? novos[0].contaId : null;
      venda.conciliada = novos.every(p => p.conciliado || !p.valor);
    } else if (!venda.pagamentos) {
      venda.pagamentos = anterior.pagamentos;
    }

    const formatar = (v) => Number(v).toFixed(2).replace('.', ',');
    venda.alteracoes = [...(venda.alteracoes || []), {
      data: agora, motivo,
      de: { total: anterior.total, desconto: anterior.desconto, itens: anterior.itens.length,
            pagamento: descreverPagamento({ pagamentos: anterior.pagamentos }, formatar) },
      para: { total: venda.total, desconto: venda.desconto || 0, itens: venda.itens.length,
              pagamento: descreverPagamento(venda, formatar) }
    }];
    await pedido(lojaVendas.put(venda));

    if (refazerFinanceiro) {
      const lancamentos = tx.objectStore('lancamentos');
      for (const l of await pedido(lancamentos.getAll())) {
        if (l.refTipo === 'venda' && l.refId === vendaId && l.tipo === 'venda') await pedido(lancamentos.delete(l.id));
      }
      await lancarPagamentos(tx, venda, vendaId, ' (alterada)');
    }
    return venda;
  });
}

/* ---------------- Cadastro de produto ---------------- */

/**
 * Salva o cadastro. O estoque informado num produto novo entra no livro como
 * saldo de abertura; num produto existente, uma mudança de saldo pelo
 * cadastro vira ajuste — o normal é usar Entrada ou Ajuste, que pedem motivo.
 */
export function salvarProduto(produto) {
  return transacao(['produtos', 'estoqueMov'], 'readwrite', async (tx) => {
    const loja = tx.objectStore('produtos');
    const anterior = produto.id != null ? await pedido(loja.get(produto.id)) : null;
    const id = await pedido(loja.put(produto));
    const diferenca = (Number(produto.estoque) || 0) - (Number(anterior?.estoque) || 0);
    await registrarMovimento(tx, {
      produtoId: id, qtd: diferenca, tipo: anterior ? 'ajuste' : 'abertura',
      motivo: anterior ? 'cadastro' : null, saldo: Number(produto.estoque) || 0,
      obs: anterior ? 'Saldo alterado no cadastro do produto' : 'Estoque informado no cadastro'
    });
    return id;
  });
}

/* ---------------- Atualização dos dados (versões anteriores) ---------------- */

/**
 * Monta o livro de estoque a partir do histórico que já existe: vendas (e os
 * cancelamentos delas), ajustes, inventários e as entradas guardadas no
 * produto. O que o histórico não explica — o estoque digitado no cadastro, o
 * que veio de outro sistema, entradas antigas demais — vira um "saldo de
 * abertura" antes do primeiro movimento, de modo que a soma do livro feche
 * sempre com o estoque atual de cada produto.
 */
export async function reconstruirLivroEstoque() {
  const [produtos, vendas, ajustes, lancamentos] = await Promise.all([
    listar('produtos'), listar('vendas'), listar('ajustes'), listar('lancamentos')
  ]);
  const existe = new Set(produtos.map(p => p.id));
  const estornoEm = new Map();
  for (const l of lancamentos) if (l.tipo === 'estorno' && l.refTipo === 'venda') estornoEm.set(l.refId, l.data);

  const movs = [];
  const add = (m) => { if (existe.has(m.produtoId) && Number(m.qtd)) movs.push({ refTipo: null, refId: null, obs: '', saldo: null, motivo: null, ...m }); };

  for (const v of vendas) {
    for (const i of v.itens || []) {
      add({ produtoId: i.produtoId, qtd: -(Number(i.qtd) || 0), tipo: 'venda', data: v.data,
            refTipo: 'venda', refId: v.id, obs: `Venda ${v.codigo}` });
      if (v.cancelada) {
        add({ produtoId: i.produtoId, qtd: Number(i.qtd) || 0, tipo: 'cancelamento',
              data: v.canceladaEm || estornoEm.get(v.id) || v.data,
              refTipo: 'venda', refId: v.id, obs: `Cancelamento da venda ${v.codigo}` });
      }
    }
  }
  for (const a of ajustes) {
    if (a.motivo === 'preco') continue;
    add({ produtoId: a.produtoId, qtd: Number(a.diferenca) || 0, tipo: a.motivo === 'inventario' ? 'inventario' : 'ajuste',
          motivo: a.motivo, data: a.data, refTipo: 'ajuste', refId: a.id, saldo: a.depois ?? null, obs: a.observacao || '' });
  }
  // entradas de mercadoria: no produto, são as que têm custo da nota ou fornecedor
  for (const p of produtos) {
    for (const m of p.movimentos || []) {
      if (!('custoUnitario' in m) && !('fornecedor' in m)) continue;
      add({ produtoId: p.id, qtd: Number(m.qtd) || 0, tipo: m.qtd > 0 ? 'entrada' : 'saida_manual',
            data: m.data, saldo: m.saldo ?? null, obs: [m.fornecedor, m.obs].filter(Boolean).join(' — ') });
    }
  }

  // abertura: fecha o livro com o estoque atual
  for (const p of produtos) {
    const doProduto = movs.filter(m => m.produtoId === p.id);
    const soma = doProduto.reduce((a, m) => a + m.qtd, 0);
    const diferenca = Number(((Number(p.estoque) || 0) - soma).toFixed(3));
    if (!diferenca) continue;
    const primeira = doProduto.map(m => Date.parse(m.data)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    const quando = Number.isFinite(primeira) ? new Date(primeira - 1000)
      : (p.criadoEm ? new Date(p.criadoEm) : new Date());
    movs.push({
      produtoId: p.id, qtd: diferenca, tipo: 'abertura', data: quando.toISOString(),
      refTipo: null, refId: null, saldo: null, motivo: 'reconstrucao',
      obs: 'Saldo anterior ao histórico registrado no aplicativo'
    });
  }

  movs.sort((a, b) => String(a.data).localeCompare(String(b.data)));
  await transacao(['estoqueMov'], 'readwrite', async (tx) => {
    const loja = tx.objectStore('estoqueMov');
    await pedido(loja.clear());
    for (const m of movs) await pedido(loja.add(m));
  });
  return movs.length;
}

/**
 * Leva os dados ao formato desta versão. Roda na abertura do aplicativo e
 * depois de restaurar um backup — por isso um backup da versão anterior
 * restaura sem perder nada:
 *  - vendas de forma única ganham a lista `pagamentos`;
 *  - o livro de estoque é montado a partir do histórico.
 * Rodar de novo não estraga nada.
 */
export async function atualizarEsquema({ reconstruir = false } = {}) {
  const versao = await config('esquemaDados', 3);
  if (versao >= ESQUEMA_DADOS && !reconstruir) return { atualizado: false };

  await transacao(['vendas'], 'readwrite', async (tx) => {
    const loja = tx.objectStore('vendas');
    for (const v of await pedido(loja.getAll())) {
      if (Array.isArray(v.pagamentos) && v.pagamentos.length) continue;
      v.pagamentos = pagamentosDe(v);
      if (v.descontoItens == null) v.descontoItens = 0;
      await pedido(loja.put(v));
    }
  });
  const movimentos = await reconstruirLivroEstoque();
  await definirConfig('esquemaDados', ESQUEMA_DADOS);
  return { atualizado: true, de: versao, movimentos };
}

/* ---------------- Backup ---------------- */

/** Exporta todo o banco para um objeto simples, pronto para virar JSON. */
export async function exportarTudo({ incluirFotos = true, somenteCadastros = false } = {}) {
  const dados = {};
  const colecoes = somenteCadastros ? COLECOES_CADASTRO : COLECOES;
  for (const colecao of colecoes) {
    if (colecao === 'comprovantes' && !incluirFotos) { dados[colecao] = []; continue; }
    dados[colecao] = await listar(colecao);
  }
  if (somenteCadastros) {
    // o backup de cadastros serve para começar outra loja ou outro celular:
    // vai sem estoque e sem nada que dependa de venda
    dados.produtos = (dados.produtos || []).map(p => ({ ...p, estoque: 0, movimentos: [] }));
    dados.contas = (dados.contas || []).map(c => ({ ...c, saldoInicial: 0 }));
    dados.config = (dados.config || []).filter(c => c.chave !== 'contadorVendas');
  }
  return {
    aplicativo: 'Loja das Argamassas — Caruaru',
    versao: VERSAO,
    esquema: ESQUEMA_DADOS,
    geradoEm: new Date().toISOString(),
    incluiFotos: somenteCadastros ? false : incluirFotos,
    tipo: somenteCadastros ? 'cadastros' : 'completo',
    dados
  };
}

/**
 * Importa um backup. `modo` 'substituir' apaga tudo antes; 'juntar' mantém o que existe
 * e acrescenta os registros do arquivo com novas chaves.
 */
export async function importarTudo(backup, modo = 'substituir') {
  if (!backup?.dados) throw new Error('Arquivo de backup inválido');
  const colecoes = COLECOES.filter(c => Array.isArray(backup.dados[c]) || c === 'config');
  const total = await transacao(colecoes, 'readwrite', async (tx) => {
    let total = 0;
    for (const colecao of colecoes) {
      const loja = tx.objectStore(colecao);
      if (modo === 'substituir') await pedido(loja.clear());
      for (const registro of backup.dados[colecao] || []) {
        const copia = { ...registro };
        if (modo === 'juntar' && colecao !== 'config') delete copia.id;
        await pedido(loja.put(copia));
        total++;
      }
    }
    return total;
  });

  // Backup de versão anterior (sem livro de estoque) ou junção com outro
  // aparelho: o livro é remontado a partir do histórico restaurado.
  const temLivro = Array.isArray(backup.dados.estoqueMov) && modo !== 'juntar';
  await atualizarEsquema({ reconstruir: !temLivro });
  return total;
}

/** Apaga todo o conteúdo, mantendo a configuração da loja. */
export async function apagarMovimento() {
  for (const colecao of ['vendas', 'despesas', 'lancamentos', 'comprovantes']) await limpar(colecao);
  // o estoque continua: o livro recomeça com o saldo de hoje de cada produto
  await reconstruirLivroEstoque();
}

/** Tamanho aproximado ocupado no aparelho. */
export async function espacoUsado() {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { usado: usage || 0, total: quota || 0 };
}
