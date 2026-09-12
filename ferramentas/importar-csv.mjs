/**
 * Converte os relatórios do sistema antigo (CSV) num arquivo de backup que o
 * aplicativo da Loja Caruaru restaura.
 *
 *   node ferramentas/importar-csv.mjs Products.csv Customers.csv Sales.csv saida.json
 *
 * Decisões que valem saber:
 *
 * - As vendas antigas entram SEM lançar nas contas. O dinheiro daquelas vendas
 *   já foi gasto, sacado ou transferido; jogá-lo nos saldos de hoje faria o
 *   aplicativo mostrar um caixa que não existe. O histórico alimenta
 *   faturamento, lucro e ranking; os saldos você informa uma vez em
 *   Contas › editar › saldo inicial.
 * - O preço do item vem rateado pelo total da venda, não pela tabela atual:
 *   é o que preserva os valores que você já fechou.
 * - O custo sai do lucro registrado em cada venda (custo = total − lucro),
 *   mantendo a margem histórica exata.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/* ---------------- Leitura de CSV ---------------- */

/** Lê CSV com aspas e vírgulas dentro do campo. */
function lerCsv(caminho) {
  const texto = readFileSync(caminho, 'utf8').replace(/^\ufeff/, '');
  const linhas = [];
  let campo = '', linha = [], dentroDeAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroDeAspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') dentroDeAspas = false;
      else campo += c;
    } else if (c === '"') dentroDeAspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }

  const cabecalho = linhas.shift().map(h => h.trim());
  return linhas
    .filter(l => l.some(c => c.trim()))
    .map(l => Object.fromEntries(cabecalho.map((h, i) => [h, (l[i] ?? '').trim()])));
}

/** "1.090,50" -> 1090.5 (ponto é separador de milhar no relatório). */
const num = (s) => {
  const limpo = String(s ?? '').trim().replace(/\./g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
};

/** "20/07/2026 14:35" -> ISO. */
function data(br) {
  const m = String(br || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return new Date().toISOString();
  const [, d, mes, ano, hora = '12', minuto = '00'] = m;
  return new Date(`${ano}-${mes}-${d}T${hora}:${minuto}:00`).toISOString();
}

const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

/* ---------------- Categorias ---------------- */

/** O relatório vem sem categoria; deduzimos pelo nome para o PDV ter filtros. */
function categoriaDe(nome) {
  const n = normalizar(nome);
  if (n.includes('argamassa')) return 'Argamassas';
  if (n.includes('rejunte')) return 'Rejuntes';
  if (n.includes('cimento') || n.includes('cal ') || n.startsWith('cal') || n.includes('calcario')) return 'Cimento e Cal';
  if (n.includes('massa') || n.includes('gesso')) return 'Massas e Gesso';
  if (n.includes('tinta')) return 'Tintas';
  if (n.includes('manta') || n.includes('impermeab')) return 'Impermeabilizantes';
  return 'Outros';
}

/** "unidade" -> "UN"; o resto vira sigla curta, que é o que cabe no cupom. */
function unidadeDe(bruta) {
  const n = normalizar(bruta);
  const mapa = { unidade: 'UN', un: 'UN', saco: 'SC', sc: 'SC', caixa: 'CX', cx: 'CX',
                 balde: 'BD', bd: 'BD', metro: 'M', kg: 'KG', litro: 'L', pacote: 'PCT' };
  return mapa[n] || (bruta || 'UN').toUpperCase().slice(0, 4);
}

const PAGAMENTOS = {
  'pix': 'pix', 'cash': 'dinheiro', 'dinheiro': 'dinheiro',
  'cartao de credito': 'credito', 'credit card': 'credito',
  'cartao de debito': 'debito', 'debit card': 'debito',
  'boleto': 'boleto', 'others': 'outros', 'outros': 'outros'
};

/* ---------------- Conversão ---------------- */

export function converter(caminhoProdutos, caminhoClientes, caminhoVendas) {
  const avisos = [];

  /* --- produtos --- */
  const produtos = [];
  const porNome = new Map();
  for (const [i, p] of lerCsv(caminhoProdutos).entries()) {
    const nome = p['Nome'];
    if (!nome) continue;
    const registro = {
      id: i + 1,
      nome,
      categoria: categoriaDe(nome),
      unidade: unidadeDe(p['Unit / Frac.']),
      custo: num(p['Preço de Custo']),
      preco: num(p['Preço de Venda']),
      estoque: num(p['Estoque Atual']),
      estoqueMin: num(p['Estoque Minimo']),
      ativo: true,
      movimentos: []
    };
    produtos.push(registro);
    porNome.set(normalizar(nome), registro);
  }

  /* --- clientes --- */
  const clientes = [];
  const clientePorNome = new Map();
  for (const [i, c] of lerCsv(caminhoClientes).entries()) {
    const nome = c['Nome'];
    if (!nome) continue;
    const registro = {
      id: i + 1,
      nome,
      telefone: (c['Telefone'] || c['Telefone 2'] || '').replace(/\D/g, ''),
      email: c['Email'] || '',
      doc: c['N° Doc.'] || '',
      endereco: c['Endereço'] || '',
      cidade: '',
      obs: c['Observações'] || '',
      criadoEm: data(c['Data Criação'])
    };
    clientes.push(registro);
    // o primeiro cadastro de cada nome vence: o relatório tem duplicidades
    if (!clientePorNome.has(normalizar(nome))) clientePorNome.set(normalizar(nome), registro);
  }

  /* --- vendas --- */
  // Cada item da descrição começa com "<qtd>x". Cortar por vírgula só quando
  // vier logo antes desse padrão evita quebrar nomes como "Massa Corrida 12,5kg".
  const separador = /,\s*(?=\d+(?:[.,]\d+)?x)/;
  const item = /^(\d+(?:[.,]\d+)?)x(.+)$/;

  const vendas = [];
  const naoEncontrados = new Map();
  let semItens = 0;

  for (const [i, v] of lerCsv(caminhoVendas).entries()) {
    const descricao = (v['Descri. itens'] || '').trim();
    if (!descricao) { semItens++; continue; }

    const brutos = descricao.split(separador).map(parte => {
      const m = item.exec(parte.trim());
      if (!m) return null;
      const nome = m[2].trim();
      const produto = porNome.get(normalizar(nome));
      if (!produto) naoEncontrados.set(nome, (naoEncontrados.get(nome) || 0) + 1);
      return { qtd: num(m[1]), nome, produto };
    }).filter(Boolean);
    if (!brutos.length) { semItens++; continue; }

    const subtotal = num(v['Subtotal']);
    const desconto = num(v['Desconto']);
    const total = num(v['Total']);
    const lucro = num(v['Lucro']);
    const custoTotal = Math.max(0, total - lucro);

    // Rateio: os preços mudaram desde a venda, então distribuímos o valor
    // realmente cobrado na proporção da tabela vigente hoje.
    const pesoPreco = brutos.reduce((a, b) => a + b.qtd * (b.produto?.preco || 1), 0) || 1;
    const pesoCusto = brutos.reduce((a, b) => a + b.qtd * (b.produto?.custo || 1), 0) || 1;

    const itens = brutos.map(b => {
      const fatiaPreco = (b.qtd * (b.produto?.preco || 1)) / pesoPreco;
      const fatiaCusto = (b.qtd * (b.produto?.custo || 1)) / pesoCusto;
      const totalItem = Number((subtotal * fatiaPreco).toFixed(2));
      return {
        produtoId: b.produto?.id ?? null,
        nome: b.produto?.nome || b.nome,
        unidade: b.produto?.unidade || 'UN',
        qtd: b.qtd,
        preco: Number((totalItem / (b.qtd || 1)).toFixed(4)),
        custo: Number(((custoTotal * fatiaCusto) / (b.qtd || 1)).toFixed(4)),
        total: totalItem
      };
    });

    vendas.push({
      id: i + 1,
      codigo: v['Número'] || `IMP-${i + 1}`,
      data: data(v['Data/Hora']),
      clienteId: clientePorNome.get(normalizar(v['Cliente']))?.id ?? null,
      clienteNome: v['Cliente'] || null,
      clienteTelefone: clientePorNome.get(normalizar(v['Cliente']))?.telefone || null,
      itens,
      subtotal, desconto, total,
      custo: Number(custoTotal.toFixed(2)),
      lucro: Number(lucro.toFixed(2)),
      pagamento: PAGAMENTOS[normalizar(v['Meios de Pagamento'])] || 'outros',
      vendedor: v['Vendedor'] || '',
      observacao: v['Observação'] || '',
      entrega: num(v['Entrega']),
      cancelada: false,
      temComprovante: false,
      contaId: null,        // histórico não mexe no saldo das contas de hoje
      importada: true
    });
  }

  if (semItens) avisos.push(`${semItens} venda(s) sem itens legíveis foram ignoradas.`);
  for (const [nome, n] of naoEncontrados) {
    avisos.push(`Produto "${nome}" aparece em ${n} venda(s) mas não está no cadastro — o item foi mantido na venda sem vínculo com o estoque.`);
  }

  return { produtos, clientes, vendas, avisos };
}

/* ---------------- Linha de comando ---------------- */

const [, , fProdutos, fClientes, fVendas, fSaida = 'backup-importado.json'] = process.argv;
if (!fProdutos || !fClientes || !fVendas) {
  console.error('uso: node ferramentas/importar-csv.mjs Products.csv Customers.csv Sales.csv [saida.json]');
  process.exit(1);
}

const { produtos, clientes, vendas, avisos } = converter(fProdutos, fClientes, fVendas);

const CONTAS = [
  { id: 1, chave: 'caixa',   nome: 'Caixa da loja', tipo: 'dinheiro', recebe: ['dinheiro'],          ordem: 1, saldoInicial: 0, ativa: true },
  { id: 2, chave: 'pix',     nome: 'Conta PIX',     tipo: 'banco',    recebe: ['pix'],               ordem: 2, saldoInicial: 0, ativa: true },
  { id: 3, chave: 'cartoes', nome: 'Conta Cartões', tipo: 'banco',    recebe: ['debito', 'credito'], ordem: 3, saldoInicial: 0, ativa: true }
];

const backup = {
  aplicativo: 'Loja das Argamassas — Caruaru',
  versao: 2,
  geradoEm: new Date().toISOString(),
  incluiFotos: false,
  origem: 'importação do sistema anterior',
  dados: {
    produtos, clientes, vendas,
    despesas: [], contas: CONTAS, lancamentos: [], comprovantes: [],
    config: [
      { chave: 'configurado', valor: true },
      { chave: 'loja', valor: { nome: 'Loja das Argamassas — Caruaru', telefone: '' } },
      { chave: 'intervaloBackup', valor: 1 },
      { chave: 'contadorVendas', valor: 0 }
    ]
  }
};

writeFileSync(fSaida, JSON.stringify(backup));

const faturamento = vendas.reduce((a, v) => a + v.total, 0);
const lucro = vendas.reduce((a, v) => a + v.lucro, 0);
const porPagamento = vendas.reduce((m, v) => (m[v.pagamento] = (m[v.pagamento] || 0) + v.total, m), {});
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

console.log(`\nArquivo gerado: ${fSaida}\n`);
console.log(`  ${produtos.length} produtos`);
console.log(`  ${clientes.length} clientes`);
console.log(`  ${vendas.length} vendas · ${brl(faturamento)} faturados · ${brl(lucro)} de lucro`);
console.log('\n  por forma de pagamento:');
for (const [forma, valor] of Object.entries(porPagamento).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${forma.padEnd(10)} ${brl(valor).padStart(14)}  (${(valor / faturamento * 100).toFixed(1)}%)`);
}
if (avisos.length) { console.log('\n  avisos:'); for (const a of avisos) console.log('    - ' + a); }
console.log('\n  As vendas antigas NÃO entram no saldo das contas — informe o saldo real de');
console.log('  cada conta em Contas › tocar na conta › Editar conta › Saldo inicial.\n');
