/* ============================================================
   Conferência do extrato bancário com as vendas.

   Lê o extrato (OFX ou CSV), procura para cada crédito a venda que o originou
   e transforma o que sobra em pré-lançamentos para o dono aprovar. Nada entra
   no financeiro sem aprovação — o sistema sugere, quem decide é você.
   ============================================================ */
import { listar, salvar, lancar } from './db.js';

/* ---------------- Leitura do arquivo ---------------- */

const soNumero = (s) => {
  const limpo = String(s ?? '').replace(/[^\d,.\-]/g, '').trim();
  if (!limpo) return NaN;
  // 1.234,56 (brasileiro) x 1,234.56 (inglês): manda a última pontuação
  const ultimaVirgula = limpo.lastIndexOf(','), ultimoPonto = limpo.lastIndexOf('.');
  let normal = limpo;
  if (ultimaVirgula > ultimoPonto) normal = limpo.replace(/\./g, '').replace(',', '.');
  else if (ultimoPonto > ultimaVirgula) normal = limpo.replace(/,/g, '');
  const n = Number(normal);
  return Number.isFinite(n) ? n : NaN;
};

const soDia = (iso) => String(iso).slice(0, 10);

function dataDe(bruta) {
  const t = String(bruta || '').trim();
  let m = t.match(/^(\d{4})(\d{2})(\d{2})/);                    // OFX: 20260831...
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);      // 31/08/2026
  if (m) {
    const ano = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/);                        // 2026-08-31
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** OFX: cada movimento vem num bloco STMTTRN. */
function lerOfx(texto) {
  const linhas = [];
  for (const bloco of texto.split(/<STMTTRN>/i).slice(1)) {
    const campo = (tag) => (bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i')) || [])[1]?.trim() || '';
    const data = dataDe(campo('DTPOSTED'));
    const valor = soNumero(campo('TRNAMT'));
    if (!data || !Number.isFinite(valor)) continue;
    linhas.push({
      data, valor,
      descricao: [campo('MEMO'), campo('NAME')].filter(Boolean).join(' — ') || 'Movimento',
      documento: campo('FITID')
    });
  }
  return linhas;
}

/** CSV: descobre sozinho quais colunas são data, valor e descrição. */
function lerCsv(texto) {
  const separador = (texto.match(/;/g) || []).length > (texto.match(/,/g) || []).length ? ';' : ',';
  const linhas = texto.split(/\r?\n/).filter(l => l.trim());
  const celulas = linhas.map(l => {
    const partes = []; let campo = '', aspas = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (aspas) { if (c === '"' && l[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c; }
      else if (c === '"') aspas = true;
      else if (c === separador) { partes.push(campo.trim()); campo = ''; }
      else campo += c;
    }
    partes.push(campo.trim());
    return partes;
  });

  // a primeira linha em que a maioria das células vira data/valor é onde começam os dados
  let inicio = 0;
  for (let i = 0; i < Math.min(celulas.length, 15); i++) {
    if (celulas[i].some(c => dataDe(c)) && celulas[i].some(c => Number.isFinite(soNumero(c)))) { inicio = i; break; }
  }

  const dados = celulas.slice(inicio).filter(l => l.length >= 2);
  if (!dados.length) return [];

  const colunaData = dados[0].findIndex(c => dataDe(c));
  // valor é a última coluna numérica que não é a data e tem casas decimais em boa parte das linhas
  const candidatas = dados[0].map((_, i) => i).filter(i => i !== colunaData);
  let colunaValor = -1, melhor = 0;
  for (const i of candidatas) {
    const acertos = dados.filter(l => Number.isFinite(soNumero(l[i])) && String(l[i]).trim() !== '').length;
    if (acertos > melhor) { melhor = acertos; colunaValor = i; }
  }
  const colunaTexto = dados[0].map((_, i) => i)
    .filter(i => i !== colunaData && i !== colunaValor)
    .sort((a, b) => (dados[0][b] || '').length - (dados[0][a] || '').length)[0];

  return dados.map(l => {
    const data = dataDe(l[colunaData]);
    const valor = soNumero(l[colunaValor]);
    if (!data || !Number.isFinite(valor) || valor === 0) return null;
    return { data, valor, descricao: (l[colunaTexto] || 'Movimento').slice(0, 90), documento: '' };
  }).filter(Boolean);
}

/** Reconhece o formato e devolve as linhas do extrato. */
export function lerExtrato(texto, nomeArquivo = '') {
  const linhas = /<STMTTRN>/i.test(texto) || /OFXHEADER/i.test(texto) || nomeArquivo.toLowerCase().endsWith('.ofx')
    ? lerOfx(texto) : lerCsv(texto);
  if (!linhas.length) throw new Error('Não encontrei lançamentos neste arquivo. Exporte o extrato em OFX ou CSV.');
  return linhas.sort((a, b) => a.data.localeCompare(b.data));
}

/* ---------------- Conferência ---------------- */

const PAGAMENTO_DA_CONTA = { pix: ['pix'], cartoes: ['debito', 'credito'], caixa: ['dinheiro'] };

/**
 * Compara cada linha do extrato com as vendas.
 *
 * O PIX cai na hora, então a janela é curta. Cartão é liquidado depois — débito
 * no dia seguinte, crédito em torno de 30 dias — e costuma vir agrupado num
 * único depósito, já descontada a taxa. Por isso existem os três testes:
 * valor exato, soma do dia, e soma do dia com taxa dentro da tolerância.
 */
export function conferir(linhasExtrato, vendas, { conta, janelaDias = null, toleranciaTaxa = 5 } = {}) {
  const formas = PAGAMENTO_DA_CONTA[conta?.chave] || (conta?.recebe || []);
  const janela = janelaDias ?? (formas.includes('credito') ? 40 : formas.includes('debito') ? 5 : 2);

  const candidatas = vendas
    .filter(v => !v.cancelada && formas.includes(v.pagamento) && !v.conciliada)
    .map(v => ({ ...v, dia: soDia(v.data) }));
  const usadas = new Set();

  const diferencaDias = (a, b) => Math.abs((new Date(a) - new Date(b)) / 864e5);

  const resultado = linhasExtrato.map((linha, indice) => {
    const base = { ...linha, indice, status: 'pendente', vendas: [], sugestao: null, taxa: 0 };

    if (linha.valor <= 0) {
      return { ...base, status: 'despesa', sugestao: { tipo: 'despesa', valor: Math.abs(linha.valor) } };
    }

    // 1. uma venda com o valor exato, dentro da janela
    const exata = candidatas.find(v => !usadas.has(v.id) &&
      Math.abs(v.total - linha.valor) < 0.01 && diferencaDias(v.dia, linha.data) <= janela);
    if (exata) {
      usadas.add(exata.id);
      return { ...base, status: 'conciliado', tipoEncontro: 'exato', vendas: [exata.id],
               detalhe: `Venda ${exata.codigo} de ${exata.dia.split('-').reverse().join('/')}` };
    }

    // 2. o depósito é a soma das vendas de um mesmo dia
    const porDia = new Map();
    for (const v of candidatas) {
      if (usadas.has(v.id) || diferencaDias(v.dia, linha.data) > janela) continue;
      if (!porDia.has(v.dia)) porDia.set(v.dia, []);
      porDia.get(v.dia).push(v);
    }
    for (const [dia, lista] of porDia) {
      const soma = lista.reduce((a, v) => a + v.total, 0);
      const diferenca = soma - linha.valor;
      const percentual = soma > 0 ? (diferenca / soma) * 100 : 100;

      if (Math.abs(diferenca) < 0.01) {
        lista.forEach(v => usadas.add(v.id));
        return { ...base, status: 'conciliado', tipoEncontro: 'lote', vendas: lista.map(v => v.id),
                 detalhe: `${lista.length} venda(s) de ${dia.split('-').reverse().join('/')}` };
      }
      // 3. mesma soma, menos a taxa da maquininha
      if (diferenca > 0 && percentual <= toleranciaTaxa) {
        lista.forEach(v => usadas.add(v.id));
        return { ...base, status: 'conciliado', tipoEncontro: 'lote_taxa', vendas: lista.map(v => v.id),
                 taxa: Number(diferenca.toFixed(2)),
                 detalhe: `${lista.length} venda(s) de ${dia.split('-').reverse().join('/')} · taxa de ${diferenca.toFixed(2).replace('.', ',')} (${percentual.toFixed(1)}%)` };
      }
    }

    // sobrou: é dinheiro que entrou sem venda correspondente
    return { ...base, status: 'receita', sugestao: { tipo: 'receita', valor: linha.valor } };
  });

  const vendasSemExtrato = candidatas.filter(v => !usadas.has(v.id));
  return {
    linhas: resultado,
    resumo: {
      total: resultado.length,
      conciliados: resultado.filter(l => l.status === 'conciliado').length,
      receitas: resultado.filter(l => l.status === 'receita').length,
      despesas: resultado.filter(l => l.status === 'despesa').length,
      taxasTotal: Number(resultado.reduce((a, l) => a + (l.taxa || 0), 0).toFixed(2)),
      valorConciliado: Number(resultado.filter(l => l.status === 'conciliado')
        .reduce((a, l) => a + l.valor, 0).toFixed(2)),
      vendasSemExtrato: vendasSemExtrato.length,
      valorVendasSemExtrato: Number(vendasSemExtrato.reduce((a, v) => a + v.total, 0).toFixed(2))
    },
    vendasSemExtrato
  };
}

/* ---------------- Aprovação ---------------- */

/** Marca as vendas como conferidas e, havendo taxa, lança a despesa dela. */
export async function aprovarConciliacao(linha, conta) {
  for (const id of linha.vendas) {
    const venda = (await listar('vendas')).find(v => v.id === id);
    if (venda) await salvar('vendas', { ...venda, conciliada: true, conciliadaEm: new Date().toISOString() });
  }
  if (linha.taxa > 0) {
    await lancar({
      contaId: conta.id, tipo: 'despesa', valor: -linha.taxa,
      descricao: `Taxa da maquininha — ${linha.descricao}`.slice(0, 120),
      categoria: 'taxa_cartao', data: new Date(`${linha.data}T12:00:00`).toISOString()
    });
  }
}

/** Aprova um pré-lançamento de receita ou despesa e joga na conta. */
export async function aprovarLancamento(linha, conta, { categoria = null, descricao = null } = {}) {
  const ehReceita = linha.valor > 0;
  return lancar({
    contaId: conta.id,
    tipo: ehReceita ? 'receita' : 'despesa',
    valor: ehReceita ? linha.valor : -Math.abs(linha.valor),
    descricao: (descricao || linha.descricao || 'Lançamento do extrato').slice(0, 140),
    categoria,
    data: new Date(`${linha.data}T12:00:00`).toISOString()
  });
}
