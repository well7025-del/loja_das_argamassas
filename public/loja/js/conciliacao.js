/* ============================================================
   Conferência do extrato bancário com as vendas.

   Lê o extrato (OFX ou CSV), procura para cada crédito a venda que o originou
   e transforma o que sobra em pré-lançamentos para o dono aprovar. Nada entra
   no financeiro sem aprovação — o sistema sugere, quem decide é você.

   Uma venda dividida (PIX + dinheiro, por exemplo) é conferida por parte: o
   crédito do PIX casa com a parte em PIX, não com o total da venda.
   ============================================================ */
import { obter, salvar, lancar } from './db.js';
import { pagamentosDe } from './regras.js';

/* ---------------- Abrir o arquivo ---------------- */

/**
 * Lê o arquivo escolhido e devolve o texto já na codificação certa.
 *
 * Banco brasileiro exporta muito em Windows-1252 (o "Latin-1" do Excel), e ler
 * isso como UTF-8 estraga os acentos. Tentamos UTF-8 estrito primeiro; se não
 * for UTF-8 válido, é 1252. Planilha do Excel e PDF são recusados com uma
 * explicação, em vez de virar "não encontrei lançamentos".
 */
export async function lerArquivoExtrato(arquivo) {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  if (!bytes.length) throw new Error('O arquivo está vazio');

  const comeca = (...b) => b.every((v, i) => bytes[i] === v);
  if (comeca(0x25, 0x50, 0x44, 0x46)) {
    throw new Error('Este extrato está em PDF, que não dá para ler. No aplicativo do banco, exporte em OFX ou CSV.');
  }
  if (comeca(0x50, 0x4B) || comeca(0xD0, 0xCF, 0x11, 0xE0)) {
    throw new Error('Este arquivo é uma planilha do Excel (.xls/.xlsx). No banco, escolha OFX ou CSV — ' +
      'ou abra a planilha e salve como CSV.');
  }

  let texto;
  if (comeca(0xFF, 0xFE)) texto = new TextDecoder('utf-16le').decode(bytes.subarray(2));
  else if (comeca(0xFE, 0xFF)) texto = new TextDecoder('utf-16be').decode(bytes.subarray(2));
  else {
    const corpo = comeca(0xEF, 0xBB, 0xBF) ? bytes.subarray(3) : bytes;
    const cabecalho = new TextDecoder('latin1').decode(corpo.subarray(0, 400));
    const declara1252 = /CHARSET:\s*(1252|ISO-?8859)/i.test(cabecalho);
    try {
      texto = declara1252 ? null : new TextDecoder('utf-8', { fatal: true }).decode(corpo);
    } catch { texto = null; }
    if (texto === null) texto = new TextDecoder('windows-1252').decode(corpo);
  }
  return texto.replace(/\u0000/g, '');
}

/* ---------------- Números e datas ---------------- */

/** Valor em reais de uma célula. Entende 1.234,56 · 1,234.56 · (12,00) · 12,00 D · R$ -5. */
export function soNumero(s) {
  const bruto = String(s ?? '').trim();
  if (!bruto) return NaN;
  const negativoPorTexto = /^\(.*\)$/.test(bruto) || /\bD\b\s*$/i.test(bruto) || /^-|\s-\s*\d|-\s*$/.test(bruto.replace(/^R\$\s*/i, ''));
  const limpo = bruto.replace(/[^\d,.]/g, '');
  if (!/\d/.test(limpo)) return NaN;
  const ultimaVirgula = limpo.lastIndexOf(','), ultimoPonto = limpo.lastIndexOf('.');
  let normal = limpo;
  if (ultimaVirgula > ultimoPonto) normal = limpo.replace(/\./g, '').replace(',', '.');
  else if (ultimoPonto > ultimaVirgula) {
    // "1.234" sem centavos é milhar; "12.50" é decimal
    const casas = limpo.length - ultimoPonto - 1;
    normal = (casas === 3 && limpo.indexOf('.') === ultimoPonto && ultimaVirgula === -1 && limpo.length > 4)
      ? limpo.replace(/\./g, '') : limpo.replace(/,/g, '');
  }
  const n = Number(normal);
  if (!Number.isFinite(n)) return NaN;
  return negativoPorTexto ? -Math.abs(n) : n;
}

const soDia = (iso) => String(iso).slice(0, 10);

/** Data AAAA-MM-DD. `ofx` libera o formato compacto 20260831, que num CSV seria número de documento. */
export function dataDe(bruta, { ofx = false } = {}) {
  const t = String(bruta || '').trim();
  let m;
  if (ofx) {
    m = t.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) return valida(m[1], m[2], m[3]);
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);                          // 2026-08-31
  if (m) return valida(m[1], m[2], m[3]);
  m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);      // 31/08/2026
  if (m) return valida(m[3].length === 2 ? '20' + m[3] : m[3], m[2], m[1]);
  return null;
}

function valida(ano, mes, dia) {
  const a = Number(ano), m = Number(mes), d = Number(dia);
  if (a < 2000 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// linhas de saldo e total que o banco intercala com os lançamentos
const LINHA_DE_SALDO = /^(saldo|s a l d o|total|sdo\b|saldo (anterior|do dia|final|atual|em c\/c))/;

/* ---------------- OFX ---------------- */

// tipos que são saída mesmo quando o banco manda o valor sem sinal
const TIPOS_DEBITO = new Set(['DEBIT', 'PAYMENT', 'FEE', 'SRVCHG', 'CHECK', 'ATM', 'POS', 'DIRECTDEBIT', 'REPEATPMT']);

function lerOfx(texto) {
  const linhas = [];
  for (const bloco of texto.split(/<STMTTRN>/i).slice(1)) {
    const corpo = bloco.split(/<\/STMTTRN>/i)[0];
    const campo = (tag) => (corpo.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, 'i')) || [])[1]?.trim() || '';
    const data = dataDe(campo('DTPOSTED') || campo('DTUSER'), { ofx: true });
    let valor = soNumero(campo('TRNAMT'));
    if (!data || !Number.isFinite(valor) || valor === 0) continue;
    if (valor > 0 && TIPOS_DEBITO.has(campo('TRNTYPE').toUpperCase())) valor = -valor;
    linhas.push({
      data, valor,
      descricao: [...new Set([campo('MEMO'), campo('NAME')].filter(Boolean))].join(' — ') || 'Movimento',
      documento: campo('FITID') || campo('CHECKNUM')
    });
  }
  return linhas;
}

/* ---------------- CSV ---------------- */

function quebrarLinha(linha, separador) {
  const partes = []; let campo = '', aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === separador) { partes.push(campo.trim()); campo = ''; }
    else campo += c;
  }
  partes.push(campo.trim());
  return partes;
}

/** O separador é o que divide as linhas no mesmo número de colunas com mais frequência. */
function descobrirSeparador(linhas) {
  let melhor = ';', nota = -1;
  for (const sep of [';', ',', '\t', '|']) {
    const contagens = linhas.slice(0, 40).map(l => quebrarLinha(l, sep).length).filter(n => n > 1);
    if (!contagens.length) continue;
    const freq = new Map();
    for (const n of contagens) freq.set(n, (freq.get(n) || 0) + 1);
    const [colunas, vezes] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const pontos = vezes * 10 + colunas;
    if (pontos > nota) { nota = pontos; melhor = sep; }
  }
  return melhor;
}

/** Acha a linha de cabeçalho e o papel de cada coluna pelo nome. */
function lerCabecalho(celulas) {
  for (let i = 0; i < Math.min(celulas.length, 40); i++) {
    const nomes = celulas[i].map(normalizar);
    const temData = nomes.some(n => /^(data|date|dt\b|dia)/.test(n));
    const temValor = nomes.some(n => /valor|value|amount|montante|quantia|credito|debito|entrada|saida/.test(n));
    if (!temData || !temValor) continue;

    const achar = (teste, ignorar = []) => nomes.findIndex((n, j) => !ignorar.includes(j) && teste(n));
    const data = achar(n => /^(data|date|dt\b|dia)/.test(n) && !/balancete|saldo/.test(n));
    const saldo = achar(n => /saldo|balance/.test(n));
    const valor = achar(n => /^(valor|value|amount|montante|quantia)|valor\s*(\(r\$\)|r\$|lancamento|da transacao)/.test(n) && !/saldo/.test(n), [saldo]);
    const credito = achar(n => /^(credito|creditos|entrada|entradas|valor credito)\b/.test(n));
    const debito = achar(n => /^(debito|debitos|saida|saidas|valor debito)\b/.test(n));
    const tipo = achar(n => /^(tipo|d\/c|c\/d|d_c|c_d|deb[\/_ ]?cred|cred[\/_ ]?deb|natureza|sinal)/.test(n), [valor, credito, debito]);
    const descricoes = nomes
      .map((n, j) => (/historico|descri|lancamento|detalhe|memo|title|estabelecimento|favorecido|complemento|identificacao/.test(n)
        && ![data, valor, credito, debito, tipo, saldo].includes(j)) ? j : -1)
      .filter(j => j >= 0);
    const documento = achar(n => /documento|^doc\b|n[ºo°]? ?doc|identificador|^id$/.test(n), [data, valor, ...descricoes]);
    // relatório da maquininha: valor bruto (o da venda) e líquido (o que cai na conta)
    const liquido = /bruto/.test(nomes[valor] || '') ? achar(n => /liquido/.test(n)) : -1;
    if (valor < 0 && credito < 0 && debito < 0) continue;
    // coluna achada pelo nome: aqui 20260831 é data mesmo (Caixa exporta assim)
    return { linha: i, data, valor, credito, debito, tipo, saldo, descricoes, documento, liquido, dataCompacta: true };
  }
  return null;
}

/** Sem cabeçalho reconhecível: deduz pelas células. */
function deduzirColunas(celulas) {
  let inicio = celulas.findIndex(l => l.some(c => dataDe(c)) && l.some(c => /\d[,.]\d{2}\b/.test(c)));
  if (inicio < 0) return null;
  const amostra = celulas.slice(inicio, inicio + 60).filter(l => l.length > 1);
  const n = Math.max(...amostra.map(l => l.length));
  const data = [...Array(n).keys()].find(j => amostra.filter(l => dataDe(l[j])).length >= amostra.length * 0.6);
  if (data === undefined) return null;

  // valor: coluna com centavos (não número de documento), preferindo a que tem negativos
  // — saldo quase sempre é positivo — e, no empate, a mais à esquerda
  let valor = -1, nota = -1;
  for (let j = 0; j < n; j++) {
    if (j === data) continue;
    const comCentavos = amostra.filter(l => /\d[,.]\d{2}(\s*[CD])?\s*$/i.test(l[j] || '') && Number.isFinite(soNumero(l[j]))).length;
    if (comCentavos < amostra.length * 0.5) continue;
    const negativos = amostra.filter(l => soNumero(l[j]) < 0).length;
    const pontos = comCentavos * 2 + (negativos > 0 ? amostra.length : 0);
    if (pontos > nota) { nota = pontos; valor = j; }
  }
  if (valor < 0) return null;
  const descricoes = [...Array(n).keys()].filter(j => j !== data && j !== valor &&
    amostra.filter(l => /[a-z]{3}/i.test(l[j] || '')).length >= amostra.length * 0.5);
  return { linha: inicio - 1, data, valor, credito: -1, debito: -1, tipo: -1, saldo: -1, descricoes, documento: -1, liquido: -1 };
}

function lerCsv(texto) {
  const brutas = texto.split(/\r\n|\n|\r/).filter(l => l.trim());
  const separador = descobrirSeparador(brutas);
  const celulas = brutas.map(l => quebrarLinha(l, separador));
  const mapa = lerCabecalho(celulas) || deduzirColunas(celulas);
  if (!mapa) return [];

  const linhas = [];
  for (const l of celulas.slice(mapa.linha + 1)) {
    const data = dataDe(l[mapa.data], { ofx: Boolean(mapa.dataCompacta) });
    if (!data) continue;

    let valor = NaN;
    if (mapa.valor >= 0) valor = soNumero(l[mapa.valor]);
    if (!Number.isFinite(valor) || valor === 0) {
      const c = mapa.credito >= 0 ? Math.abs(soNumero(l[mapa.credito]) || 0) : 0;
      const d = mapa.debito >= 0 ? Math.abs(soNumero(l[mapa.debito]) || 0) : 0;
      valor = c - d;
    }
    if (!Number.isFinite(valor) || valor === 0) continue;

    // coluna de natureza: C/D, Crédito/Débito, Entrada/Saída
    if (mapa.tipo >= 0) {
      const t = normalizar(l[mapa.tipo]);
      if (/^(d|deb|debito|saida|s)\b/.test(t)) valor = -Math.abs(valor);
      else if (/^(c|cred|credito|entrada|e)\b/.test(t)) valor = Math.abs(valor);
    }

    const descricao = [...new Set(mapa.descricoes.map(j => l[j]).filter(Boolean))].join(' — ') || 'Movimento';
    if (LINHA_DE_SALDO.test(normalizar(descricao))) continue;
    const linha = {
      data, valor: Math.round(valor * 100) / 100, descricao: descricao.slice(0, 120),
      documento: mapa.documento >= 0 ? (l[mapa.documento] || '') : ''
    };
    if (mapa.liquido >= 0) {
      const liquido = Math.abs(soNumero(l[mapa.liquido]));
      if (Number.isFinite(liquido) && liquido < Math.abs(valor)) linha.taxaInformada = Math.round((Math.abs(valor) - liquido) * 100) / 100;
    }
    linhas.push(linha);
  }
  return linhas;
}

/** Reconhece o formato pelo conteúdo (não pelo nome do arquivo) e devolve as linhas do extrato. */
export function lerExtrato(texto, nomeArquivo = '') {
  const ehOfx = /<STMTTRN>/i.test(texto) || /OFXHEADER/i.test(texto) || /<OFX>/i.test(texto);
  const linhas = ehOfx ? lerOfx(texto) : lerCsv(texto);
  if (!linhas.length) {
    const qtd = texto.split(/\r?\n/).filter(l => l.trim()).length;
    throw new Error(`Não encontrei lançamentos ${nomeArquivo ? 'em ' + nomeArquivo : 'neste arquivo'} (${qtd} linha(s) lidas como ` +
      `${ehOfx ? 'OFX' : 'CSV'}). Confira se é o extrato da conta, exportado em OFX ou CSV, com data e valor.`);
  }
  return linhas.sort((a, b) => a.data.localeCompare(b.data));
}

/* ---------------- Conferência ---------------- */

const PAGAMENTO_DA_CONTA = { pix: ['pix'], cartoes: ['debito', 'credito'], caixa: ['dinheiro'] };

/** Partes de venda ainda não conferidas que caem nesta conta. */
function partesPendentes(vendas, formas) {
  const partes = [];
  for (const v of vendas) {
    if (v.cancelada) continue;
    pagamentosDe(v).forEach((p, indice) => {
      if (!formas.includes(p.forma) || p.conciliado || !(p.valor > 0)) return;
      partes.push({
        chave: `${v.id}:${indice}`, vendaId: v.id, indice, forma: p.forma,
        codigo: v.codigo, data: v.data, dia: soDia(v.data), clienteNome: v.clienteNome,
        total: p.valor, dividida: pagamentosDe(v).length > 1
      });
    });
  }
  return partes;
}

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

  const candidatas = partesPendentes(vendas, formas);
  const usadas = new Set();
  const diferencaDias = (a, b) => Math.abs((new Date(a) - new Date(b)) / 864e5);
  const quando = (dia) => dia.split('-').reverse().join('/');
  const rotulo = (v) => `Venda ${v.codigo}${v.dividida ? ` (parte ${v.forma.toUpperCase()})` : ''}`;

  const resultado = linhasExtrato.map((linha, indice) => {
    const base = { ...linha, indice, status: 'pendente', vendas: [], sugestao: null, taxa: 0 };

    if (linha.valor <= 0) {
      return { ...base, status: 'despesa', sugestao: { tipo: 'despesa', valor: Math.abs(linha.valor) } };
    }

    // 1. uma venda (ou parte dela) com o valor exato, dentro da janela — a mais próxima na data
    const exata = candidatas
      .filter(v => !usadas.has(v.chave) && Math.abs(v.total - linha.valor) < 0.01 && diferencaDias(v.dia, linha.data) <= janela)
      .sort((a, b) => diferencaDias(a.dia, linha.data) - diferencaDias(b.dia, linha.data))[0];
    if (exata) {
      usadas.add(exata.chave);
      const taxa = linha.taxaInformada || 0;
      return { ...base, status: 'conciliado', tipoEncontro: 'exato', vendas: [exata.chave], taxa,
               detalhe: `${rotulo(exata)} de ${quando(exata.dia)}` +
                 (taxa ? ` · taxa de ${taxa.toFixed(2).replace('.', ',')} informada pela maquininha` : '') };
    }

    // 2. o depósito é a soma das vendas de um mesmo dia
    const porDia = new Map();
    for (const v of candidatas) {
      if (usadas.has(v.chave) || diferencaDias(v.dia, linha.data) > janela) continue;
      if (!porDia.has(v.dia)) porDia.set(v.dia, []);
      porDia.get(v.dia).push(v);
    }
    for (const [dia, lista] of porDia) {
      const soma = lista.reduce((a, v) => a + v.total, 0);
      const diferenca = soma - linha.valor;
      const percentual = soma > 0 ? (diferenca / soma) * 100 : 100;

      if (Math.abs(diferenca) < 0.01) {
        lista.forEach(v => usadas.add(v.chave));
        return { ...base, status: 'conciliado', tipoEncontro: 'lote', vendas: lista.map(v => v.chave),
                 detalhe: `${lista.length} venda(s) de ${quando(dia)}` };
      }
      // 3. mesma soma, menos a taxa da maquininha
      if (diferenca > 0 && percentual <= toleranciaTaxa) {
        lista.forEach(v => usadas.add(v.chave));
        return { ...base, status: 'conciliado', tipoEncontro: 'lote_taxa', vendas: lista.map(v => v.chave),
                 taxa: Number(diferenca.toFixed(2)),
                 detalhe: `${lista.length} venda(s) de ${quando(dia)} · taxa de ${diferenca.toFixed(2).replace('.', ',')} (${percentual.toFixed(1)}%)` };
      }
    }

    // sobrou: é dinheiro que entrou sem venda correspondente
    return { ...base, status: 'receita', sugestao: { tipo: 'receita', valor: linha.valor } };
  });

  const vendasSemExtrato = candidatas.filter(v => !usadas.has(v.chave));
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

/**
 * Marca como conferidas as partes de venda casadas com a linha e, havendo
 * taxa, lança a despesa dela. A venda só fica "conferida" quando todas as
 * partes que não são dinheiro foram conferidas.
 */
export async function aprovarConciliacao(linha, conta) {
  const agora = new Date().toISOString();
  for (const chave of linha.vendas) {
    const [id, indice] = String(chave).split(':').map(Number);
    const venda = await obter('vendas', id);
    if (!venda) continue;
    const pagamentos = pagamentosDe(venda).map(p => ({ ...p }));
    const alvo = Number.isInteger(indice) ? pagamentos[indice] : null;
    if (alvo) { alvo.conciliado = true; alvo.conciliadoEm = agora; }
    else pagamentos.forEach(p => { p.conciliado = true; });
    const conferida = pagamentos.filter(p => p.forma !== 'dinheiro').every(p => p.conciliado);
    await salvar('vendas', { ...venda, pagamentos, conciliada: conferida, conciliadaEm: conferida ? agora : venda.conciliadaEm });
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
