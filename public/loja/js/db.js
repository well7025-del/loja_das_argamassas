/* ============================================================
   Banco local do aplicativo (IndexedDB).
   Todos os dados ficam no proprio celular — o app funciona sem internet.
   ============================================================ */

const NOME_BANCO = 'argamassas-loja';
const VERSAO = 1;

/** Coleções do banco. `comprovantes` fica separado para o backup poder excluir as fotos. */
export const COLECOES = ['produtos', 'clientes', 'vendas', 'despesas', 'caixa', 'comprovantes', 'config'];

let bancoPromise = null;

function abrir() {
  if (bancoPromise) return bancoPromise;
  bancoPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(NOME_BANCO, VERSAO);
    req.onupgradeneeded = () => {
      const bd = req.result;
      for (const nome of COLECOES) {
        if (bd.objectStoreNames.contains(nome)) continue;
        const store = nome === 'config'
          ? bd.createObjectStore(nome, { keyPath: 'chave' })
          : bd.createObjectStore(nome, { keyPath: 'id', autoIncrement: true });
        if (nome === 'vendas') { store.createIndex('data', 'data'); store.createIndex('clienteId', 'clienteId'); }
        if (nome === 'despesas' || nome === 'caixa') store.createIndex('data', 'data');
        if (nome === 'comprovantes') store.createIndex('vendaId', 'vendaId');
        if (nome === 'produtos') store.createIndex('nome', 'nome');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Não foi possível abrir o banco local'));
  });
  return bancoPromise;
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

/* ---------------- Operações compostas ---------------- */

/**
 * Registra uma venda: grava a venda, baixa o estoque de cada item e,
 * se o pagamento for em dinheiro, lança a entrada no caixa — tudo numa
 * única transação, para nunca ficar pela metade.
 */
export function registrarVenda(venda, comprovante = null) {
  return transacao(['vendas', 'produtos', 'caixa', 'comprovantes'], 'readwrite', async (tx) => {
    const lojaProdutos = tx.objectStore('produtos');

    for (const item of venda.itens) {
      const p = await pedido(lojaProdutos.get(item.produtoId));
      if (!p) throw new Error('Produto do pedido não foi encontrado');
      if (p.estoque < item.qtd) throw new Error(`Estoque insuficiente de ${p.nome}: há ${p.estoque} ${p.unidade}`);
      p.estoque = Number((p.estoque - item.qtd).toFixed(3));
      await pedido(lojaProdutos.put(p));
    }

    const vendaId = await pedido(tx.objectStore('vendas').add(venda));

    if (comprovante) await pedido(tx.objectStore('comprovantes').add({ vendaId, imagem: comprovante }));
    if (venda.pagamento === 'dinheiro') {
      await pedido(tx.objectStore('caixa').add({
        data: venda.data, tipo: 'venda', valor: venda.total,
        descricao: `Venda ${venda.codigo}`, refId: vendaId
      }));
    }
    return vendaId;
  });
}

/** Cancela uma venda: devolve o estoque e estorna o caixa. */
export function cancelarVenda(vendaId) {
  return transacao(['vendas', 'produtos', 'caixa'], 'readwrite', async (tx) => {
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
    if (venda.pagamento === 'dinheiro') {
      await pedido(tx.objectStore('caixa').add({
        data: new Date().toISOString(), tipo: 'estorno', valor: -venda.total,
        descricao: `Estorno da venda ${venda.codigo}`, refId: vendaId
      }));
    }
    venda.cancelada = true;
    await pedido(tx.objectStore('vendas').put(venda));
  });
}

/** Lança despesa e, quando paga em dinheiro, retira do caixa. */
export function registrarDespesa(despesa) {
  return transacao(['despesas', 'caixa'], 'readwrite', async (tx) => {
    const id = await pedido(tx.objectStore('despesas').add(despesa));
    if (despesa.forma === 'dinheiro') {
      await pedido(tx.objectStore('caixa').add({
        data: despesa.data, tipo: 'despesa', valor: -despesa.valor,
        descricao: despesa.descricao || despesa.categoria, refId: id
      }));
    }
    return id;
  });
}

/** Entrada de mercadoria: soma ao estoque e registra o histórico no produto. */
export function entradaEstoque(produtoId, quantidade, observacao = '') {
  return transacao(['produtos'], 'readwrite', async (tx) => {
    const loja = tx.objectStore('produtos');
    const p = await pedido(loja.get(produtoId));
    if (!p) throw new Error('Produto não encontrado');
    const novo = Number((p.estoque + quantidade).toFixed(3));
    if (novo < 0) throw new Error(`A saída deixaria o estoque negativo (há ${p.estoque} ${p.unidade})`);
    p.estoque = novo;
    p.movimentos = [...(p.movimentos || []).slice(-49), {
      data: new Date().toISOString(), qtd: quantidade, obs: observacao, saldo: novo
    }];
    await pedido(loja.put(p));
    return novo;
  });
}

/** Saldo atual do caixa em dinheiro. */
export async function saldoCaixa() {
  const movimentos = await listar('caixa');
  return Number(movimentos.reduce((a, m) => a + m.valor, 0).toFixed(2));
}

/* ---------------- Backup ---------------- */

/** Exporta todo o banco para um objeto simples, pronto para virar JSON. */
export async function exportarTudo({ incluirFotos = true } = {}) {
  const dados = {};
  for (const colecao of COLECOES) {
    if (colecao === 'comprovantes' && !incluirFotos) { dados[colecao] = []; continue; }
    dados[colecao] = await listar(colecao);
  }
  return {
    aplicativo: 'Loja das Argamassas — Caruaru',
    versao: VERSAO,
    geradoEm: new Date().toISOString(),
    incluiFotos: incluirFotos,
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
  for (const colecao of ['vendas', 'despesas', 'caixa', 'comprovantes']) await limpar(colecao);
}

/** Tamanho aproximado ocupado no aparelho. */
export async function espacoUsado() {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { usado: usage || 0, total: quota || 0 };
}
