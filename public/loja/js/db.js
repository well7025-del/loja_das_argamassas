/* ============================================================
   Banco local do aplicativo (IndexedDB).
   Todos os dados ficam no proprio celular — o app funciona sem internet.
   ============================================================ */

const NOME_BANCO = 'argamassas-loja';
const VERSAO = 3;

/** Coleções do banco. `comprovantes` fica separado para o backup poder excluir as fotos. */
export const COLECOES = ['produtos', 'clientes', 'vendas', 'despesas', 'contas', 'lancamentos',
                         'comprovantes', 'documentos', 'ajustes', 'inventarios', 'extratos', 'config'];

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

/* ---------------- Desconto por quantidade ---------------- */

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

/** Comissão devida por um item vendido. */
export function comissaoDoItem(produto, item) {
  if (!produto?.comissao) return 0;
  const qtd = Number(item.qtd) || 0;
  const total = Number(item.total ?? (Number(item.preco) || 0) * qtd) || 0;
  return produto.comissaoTipo === 'valor'
    ? Number((produto.comissao * qtd).toFixed(2))
    : Number((total * produto.comissao / 100).toFixed(2));
}

/* ---------------- Operações compostas ---------------- */

/**
 * Registra uma venda: grava a venda, baixa o estoque de cada item e lança o
 * valor na conta correspondente à forma de pagamento — tudo numa única
 * transação, para nunca ficar pela metade.
 */
export function registrarVenda(venda, comprovante = null) {
  return transacao(['vendas', 'produtos', 'lancamentos', 'contas', 'comprovantes'], 'readwrite', async (tx) => {
    const lojaProdutos = tx.objectStore('produtos');

    for (const item of venda.itens) {
      const p = await pedido(lojaProdutos.get(item.produtoId));
      if (!p) throw new Error('Produto do pedido não foi encontrado');
      if (p.estoque < item.qtd) throw new Error(`Estoque insuficiente de ${p.nome}: há ${p.estoque} ${p.unidade}`);
      p.estoque = Number((p.estoque - item.qtd).toFixed(3));
      await pedido(lojaProdutos.put(p));
    }

    const contas = await pedido(tx.objectStore('contas').getAll());
    const conta = acharConta(contas, venda.pagamento);
    venda.contaId = conta?.id ?? null;

    const vendaId = await pedido(tx.objectStore('vendas').add(venda));

    if (comprovante) await pedido(tx.objectStore('comprovantes').add({ vendaId, imagem: comprovante }));
    if (conta) {
      await pedido(tx.objectStore('lancamentos').add({
        contaId: conta.id, data: venda.data, tipo: 'venda', valor: venda.total,
        descricao: `Venda ${venda.codigo}`, refTipo: 'venda', refId: vendaId
      }));
    }
    return vendaId;
  });
}

/** Cancela uma venda: devolve o estoque e estorna o valor na conta que recebeu. */
export function cancelarVenda(vendaId) {
  return transacao(['vendas', 'produtos', 'lancamentos'], 'readwrite', async (tx) => {
    const venda = await pedido(tx.objectStore('vendas').get(vendaId));
    if (!venda) throw new Error('Venda não encontrada');
    if (venda.cancelada) throw new Error('Esta venda já foi cancelada');

    const lojaProdutos = tx.objectStore('produtos');
    for (const item of venda.itens) {
      const p = await pedido(lojaProdutos.get(item.produtoId));
      if (!p) continue;
      p.estoque = Number((p.estoque + item.qtd).toFixed(3));
      await pedido(lojaProdutos.put(p));
    }
    if (venda.contaId) {
      await pedido(tx.objectStore('lancamentos').add({
        contaId: venda.contaId, data: new Date().toISOString(), tipo: 'estorno', valor: -venda.total,
        descricao: `Estorno da venda ${venda.codigo}`, refTipo: 'venda', refId: vendaId
      }));
    }
    venda.cancelada = true;
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
  return transacao(['produtos', 'despesas', 'lancamentos'], 'readwrite', async (tx) => {
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
  return transacao(['produtos', 'ajustes', 'documentos'], 'readwrite', async (tx) => {
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
  return transacao(['produtos', 'inventarios', 'ajustes', 'documentos'], 'readwrite', async (tx) => {
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
        await pedido(tx.objectStore('ajustes').add({
          produtoId: p.id, produtoNome: p.nome, unidade: p.unidade, motivo: 'inventario',
          antes: esperado, depois: contado, diferenca,
          valorCusto: Number((diferenca * (p.custo || 0)).toFixed(2)),
          observacao, responsavel, data: agora
        }));
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
 * Regrava uma venda já lançada: devolve o estoque dos itens antigos, baixa o
 * dos novos e refaz o lançamento na conta. Guarda o que mudou, porque uma venda
 * alterada sem trilha é exatamente o que uma auditoria procura.
 */
export function alterarVenda(vendaId, mudancas, motivo = '') {
  return transacao(['vendas', 'produtos', 'lancamentos', 'contas'], 'readwrite', async (tx) => {
    const lojaVendas = tx.objectStore('vendas');
    const lojaProdutos = tx.objectStore('produtos');
    const venda = await pedido(lojaVendas.get(vendaId));
    if (!venda) throw new Error('Venda não encontrada');
    if (venda.cancelada) throw new Error('Venda cancelada não pode ser alterada');

    const anterior = JSON.parse(JSON.stringify({
      itens: venda.itens, total: venda.total, desconto: venda.desconto,
      pagamento: venda.pagamento, clienteId: venda.clienteId
    }));

    // devolve o estoque dos itens atuais
    if (mudancas.itens) {
      for (const item of venda.itens) {
        const p = await pedido(lojaProdutos.get(item.produtoId));
        if (!p) continue;
        p.estoque = Number((p.estoque + item.qtd).toFixed(3));
        await pedido(lojaProdutos.put(p));
      }
      // e baixa os novos
      for (const item of mudancas.itens) {
        const p = await pedido(lojaProdutos.get(item.produtoId));
        if (!p) throw new Error('Produto do pedido não encontrado');
        if (p.estoque < item.qtd) throw new Error(`Estoque insuficiente de ${p.nome}: há ${p.estoque} ${p.unidade}`);
        p.estoque = Number((p.estoque - item.qtd).toFixed(3));
        await pedido(lojaProdutos.put(p));
      }
      venda.itens = mudancas.itens;
    }

    for (const campo of ['desconto', 'descontoQuantidade', 'pagamento', 'clienteId', 'clienteNome', 'clienteTelefone', 'observacao']) {
      if (mudancas[campo] !== undefined) venda[campo] = mudancas[campo];
    }

    venda.subtotal = Number(venda.itens.reduce((a, i) => a + i.total, 0).toFixed(2));
    venda.total = Number((venda.subtotal - (venda.desconto || 0)).toFixed(2));
    venda.custo = Number(venda.itens.reduce((a, i) => a + i.custo * i.qtd, 0).toFixed(2));
    venda.lucro = Number((venda.total - venda.custo).toFixed(2));

    venda.alteracoes = [...(venda.alteracoes || []), {
      data: new Date().toISOString(), motivo,
      de: { total: anterior.total, desconto: anterior.desconto, pagamento: anterior.pagamento, itens: anterior.itens.length },
      para: { total: venda.total, desconto: venda.desconto, pagamento: venda.pagamento, itens: venda.itens.length }
    }];
    await pedido(lojaVendas.put(venda));

    // refaz o lançamento financeiro: estorna o antigo e lança o novo
    const lancamentos = tx.objectStore('lancamentos');
    const todos = await pedido(lancamentos.getAll());
    for (const l of todos) {
      if (l.refTipo === 'venda' && l.refId === vendaId && l.tipo === 'venda') {
        await pedido(lancamentos.delete(l.id));
      }
    }
    const contas = await pedido(tx.objectStore('contas').getAll());
    const conta = contas.find(c => c.ativa !== false && (c.recebe || []).includes(venda.pagamento));
    venda.contaId = conta?.id ?? null;
    await pedido(lojaVendas.put(venda));
    if (conta) {
      await pedido(lancamentos.add({
        contaId: conta.id, data: venda.data, tipo: 'venda', valor: venda.total,
        descricao: `Venda ${venda.codigo} (alterada)`, refTipo: 'venda', refId: vendaId
      }));
    }
    return venda;
  });
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
    dados.produtos = (dados.produtos || []).map(p => ({ ...p, estoque: 0 }));
    dados.contas = (dados.contas || []).map(c => ({ ...c, saldoInicial: 0 }));
    dados.config = (dados.config || []).filter(c => c.chave !== 'contadorVendas');
  }
  return {
    aplicativo: 'Loja das Argamassas — Caruaru',
    versao: VERSAO,
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
  return transacao(colecoes, 'readwrite', async (tx) => {
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
}

/** Apaga todo o conteúdo, mantendo a configuração da loja. */
export async function apagarMovimento() {
  for (const colecao of ['vendas', 'despesas', 'lancamentos', 'comprovantes']) await limpar(colecao);
}

/** Tamanho aproximado ocupado no aparelho. */
export async function espacoUsado() {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { usado: usage || 0, total: quota || 0 };
}
