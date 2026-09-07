/**
 * Gera dados de demonstracao (90 dias de operacao) para conhecer o sistema.
 * Uso: npm run demo
 * Nao altera lojas, usuarios nem produtos — apenas cria clientes e movimento.
 */
import { db } from './db.js';
import { seedIfEmpty } from './seed.js';
import { applyMove, getQty } from './lib/stock.js';
import { resolveCep } from './lib/geo.js';

seedIfEmpty();

const CEPS_RECIFE = ['50050-000', '50070-450', '50610-000', '50710-000', '50920-000', '51020-000',
  '51110-000', '51160-000', '51230-000', '52020-000', '52070-000', '52130-000', '52171-011',
  '52410-000', '53020-000', '53230-000', '53401-000', '54010-000', '54250-000', '54510-000'];
const CEPS_CARUARU = ['55002-000', '55010-000', '55014-000', '55016-000', '55018-000', '55024-000',
  '55030-000', '55034-000', '55038-000', '55100-000', '55190-000', '55612-000'];

const NOMES = ['Jose Carlos Silva', 'Maria das Gracas Souza', 'Antonio Ferreira Lima', 'Construtora Alvorada Ltda',
  'Joao Batista dos Santos', 'Ana Paula Cavalcanti', 'Pedro Henrique Alves', 'Marcos Aurelio Barbosa',
  'Luciana Menezes Rocha', 'Reforma Facil Materiais', 'Severino Ramos da Silva', 'Fernanda Beatriz Nunes',
  'Carlos Eduardo Moura', 'Obras & Cia Engenharia', 'Rita de Cassia Melo', 'Paulo Roberto Tavares',
  'Juliana Farias Correia', 'Edificar Construcoes ME', 'Gilberto Nascimento', 'Sandra Regina Duarte',
  'Rafael Amorim Pessoa', 'Constrular Depot', 'Cicero Bezerra Filho', 'Patricia Andrade Vieira',
  'Manoel Gomes de Araujo', 'Vitoria Regina Campos', 'Empreiteira Norte Sul', 'Douglas Siqueira Pinto'];

const CATEGORIAS_DESPESA = [
  ['aluguel', 3200, 'Aluguel do ponto comercial'],
  ['salario', 5400, 'Folha de pagamento'],
  ['energia', 780, 'Conta de energia'],
  ['agua', 190, 'Conta de agua'],
  ['internet', 149, 'Internet e telefone'],
  ['impostos', 1250, 'Simples Nacional'],
  ['comissao', 900, 'Comissao dos vendedores']
];

const rnd = (a, b) => a + Math.random() * (b - a);
const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
const escolher = (arr) => arr[rndInt(0, arr.length - 1)];
const dataISO = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

async function criarClientes(lojas) {
  const existentes = db.prepare('SELECT COUNT(*) n FROM customers').get().n;
  if (existentes >= 20) { console.log('  clientes ja existem, mantendo os atuais'); return; }
  const ins = db.prepare(`INSERT INTO customers(name,phone,cep,address,number,district,city,uf,lat,lng,store_id,created_at)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (let i = 0; i < NOMES.length; i++) {
    const emRecife = i % 3 !== 2;
    const cep = emRecife ? escolher(CEPS_RECIFE) : escolher(CEPS_CARUARU);
    const geo = await resolveCep(cep, { online: false });
    const loja = emRecife ? lojas.recife : lojas.caruaru;
    const criado = new Date(Date.now() - rndInt(5, 120) * 864e5);
    ins.run(NOMES[i], `819${rndInt(10000000, 99999999)}`, cep, '', String(rndInt(10, 900)),
      geo?.district || '', geo?.city || '', geo?.uf || 'PE', geo?.lat ?? null, geo?.lng ?? null, loja, dataISO(criado));
  }
  console.log(`  ${NOMES.length} clientes criados`);
}

/**
 * Simulacao cronologica: a cada semana a fabrica produz e abastece as lojas;
 * todo dia as lojas vendem. Isso mantem o estoque coerente e gera um historico realista.
 */
function simularOperacao(lojas, dias = 90) {
  if (db.prepare('SELECT COUNT(*) n FROM sales').get().n > 20) { console.log('  movimento ja existe, pulando'); return; }
  const produtos = db.prepare('SELECT * FROM products WHERE active = 1').all();
  const clientes = db.prepare('SELECT id, store_id FROM customers').all();
  const usuarios = db.prepare("SELECT id, store_id FROM users WHERE role <> 'master'").all();
  const master = db.prepare("SELECT id FROM users WHERE role='master'").get();
  const pagamentos = ['dinheiro', 'dinheiro', 'pix', 'pix', 'pix', 'pix', 'debito', 'credito', 'credito', 'prazo'];

  // Pareto: poucos produtos concentram a maior parte da demanda
  const roleta = [];
  produtos.forEach((p, i) => { for (let k = 0; k < Math.max(1, Math.round(70 * Math.exp(-i / 3.4))); k++) roleta.push(p); });

  const insVenda = db.prepare(`INSERT INTO sales(code,store_id,user_id,customer_id,subtotal,discount,total,cost_total,profit,payment_method,note,created_at)
                               VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insItem = db.prepare('INSERT INTO sale_items(sale_id,product_id,qty,unit_price,unit_cost,total) VALUES(?,?,?,?,?,?)');
  const insCaixa = db.prepare(`INSERT INTO cash_movements(store_id,kind,amount,description,ref_type,ref_id,user_id,created_at)
                               VALUES(?,?,?,?,?,?,?,?)`);
  const sequencias = {};
  let totalVendas = 0, totalProducoes = 0, totalTransferencias = 0;

  /** Producao semanal na fabrica. Alguns itens ficam de fora (falta de insumo),
   *  o que gera rupturas de estoque nas lojas — como acontece na operacao real. */
  function produzir(data) {
    const foraDaSemana = new Set([escolher(produtos).id, escolher(produtos).id]);
    const itens = produtos
      .filter(p => !foraDaSemana.has(p.id))
      .map(p => ({ p, qty: Math.round(Math.max(60, p.min_stock * 9) * rnd(0.85, 1.2)) }));
    const prodId = Number(db.prepare('INSERT INTO productions(store_id,user_id,lote,note,total_qty,created_at) VALUES(?,?,?,?,?,?)')
      .run(lojas.fabrica, master?.id, `L-${data.toISOString().slice(0, 10).replace(/-/g, '')}`,
           'Producao semanal programada', itens.reduce((a, i) => a + i.qty, 0), dataISO(data)).lastInsertRowid);
    for (const { p, qty } of itens) {
      db.prepare('INSERT INTO production_items(production_id,product_id,qty) VALUES(?,?,?)').run(prodId, p.id, qty);
      applyMove({ productId: p.id, storeId: lojas.fabrica, kind: 'producao', qty, refType: 'producao', refId: prodId,
                  userId: master?.id, note: 'Producao semanal' });
    }
    totalProducoes++;
  }

  /** Abastece a loja com tudo que estiver abaixo do nivel alvo. */
  function abastecer(lojaId, data) {
    const itens = [];
    for (const p of produtos) {
      const naLoja = getQty(p.id, lojaId);
      const alvo = Math.max(20, p.min_stock * 1.8);
      if (naLoja >= alvo * 0.75) continue;
      const qty = Math.min(Math.ceil(alvo - naLoja), getQty(p.id, lojas.fabrica));
      if (qty > 0) itens.push({ p, qty });
    }
    if (!itens.length) return;
    const tId = Number(db.prepare('INSERT INTO transfers(from_store_id,to_store_id,user_id,note,created_at) VALUES(?,?,?,?,?)')
      .run(lojas.fabrica, lojaId, master?.id, 'Abastecimento da loja', dataISO(data)).lastInsertRowid);
    for (const { p, qty } of itens) {
      db.prepare('INSERT INTO transfer_items(transfer_id,product_id,qty) VALUES(?,?,?)').run(tId, p.id, qty);
      applyMove({ productId: p.id, storeId: lojas.fabrica, kind: 'transferencia_saida', qty: -qty,
                  refType: 'transferencia', refId: tId, userId: master?.id, note: 'Envio para loja' });
      applyMove({ productId: p.id, storeId: lojaId, kind: 'transferencia_entrada', qty,
                  refType: 'transferencia', refId: tId, userId: master?.id, note: 'Recebido da fabrica' });
    }
    totalTransferencias++;
  }

  db.exec('BEGIN');
  for (let d = dias; d >= 0; d--) {
    const data = new Date(Date.now() - d * 864e5);
    const dow = data.getDay();

    if (dow === 1) {                                    // segunda: produz e abastece
      data.setHours(7, 30, 0, 0);
      produzir(data);
      abastecer(lojas.recife, data);
      abastecer(lojas.caruaru, data);
    }
    if (dow === 0) continue;                            // domingo fechado

    const fator = dow === 6 ? 1.5 : dow === 5 ? 1.25 : 1;
    const crescimento = 1 + (dias - d) / dias * 0.25;

    for (const [chave, lojaId] of [['recife', lojas.recife], ['caruaru', lojas.caruaru]]) {
      const base = chave === 'recife' ? 7 : 4.5;
      const qtdeVendas = Math.max(1, Math.round(rnd(base * .6, base * 1.35) * fator * crescimento));
      const vendedor = usuarios.find(u => u.store_id === lojaId);
      const clientesLoja = clientes.filter(c => c.store_id === lojaId);

      for (let v = 0; v < qtdeVendas; v++) {
        data.setHours(rndInt(7, 18), rndInt(0, 59), rndInt(0, 59), 0);
        const linhas = [];
        for (let i = 0, alvo = rndInt(1, 4); i < alvo; i++) {
          const p = escolher(roleta);
          if (linhas.some(l => l.product_id === p.id)) continue;
          const qtd = p.sale_price > 60 ? rndInt(1, 3) : rndInt(2, 16);
          if (getQty(p.id, lojaId) < qtd) continue;
          linhas.push({ product_id: p.id, qty: qtd, unit_price: p.sale_price, unit_cost: p.cost_price,
                        total: Number((p.sale_price * qtd).toFixed(2)) });
        }
        if (!linhas.length) continue;

        const subtotal = Number(linhas.reduce((s, l) => s + l.total, 0).toFixed(2));
        const desconto = Math.random() < 0.18 ? Number((subtotal * rnd(0.02, 0.07)).toFixed(2)) : 0;
        const valor = Number((subtotal - desconto).toFixed(2));
        const custo = Number(linhas.reduce((s, l) => s + l.unit_cost * l.qty, 0).toFixed(2));
        const pagamento = escolher(pagamentos);
        const cliente = Math.random() < 0.75 && clientesLoja.length ? escolher(clientesLoja).id : null;
        const codigo = `${chave === 'recife' ? 'REC' : 'CAR'}-${String((sequencias[lojaId] = (sequencias[lojaId] || 0) + 1)).padStart(5, '0')}`;

        const id = Number(insVenda.run(codigo, lojaId, vendedor?.id || null, cliente, subtotal, desconto, valor,
          custo, Number((valor - custo).toFixed(2)), pagamento, '', dataISO(data)).lastInsertRowid);
        for (const l of linhas) {
          insItem.run(id, l.product_id, l.qty, l.unit_price, l.unit_cost, l.total);
          applyMove({ productId: l.product_id, storeId: lojaId, kind: 'venda', qty: -l.qty,
                      refType: 'venda', refId: id, userId: vendedor?.id || null, note: `Venda ${codigo}` });
        }
        if (pagamento === 'dinheiro') {
          insCaixa.run(lojaId, 'venda', valor, `Venda ${codigo}`, 'venda', id, vendedor?.id || null, dataISO(data));
        }
        totalVendas++;
      }
    }
  }
  db.exec('COMMIT');
  console.log(`  ${totalVendas} vendas, ${totalProducoes} producoes e ${totalTransferencias} transferencias em ${dias} dias`);
}

function gerarDespesasEDepositos(lojas) {
  if (db.prepare('SELECT COUNT(*) n FROM expenses').get().n > 5) { console.log('  despesas ja existem, pulando'); return; }
  const ins = db.prepare(`INSERT INTO expenses(store_id,category,description,amount,paid_with,competencia,paid_at,created_at)
                          VALUES(?,?,?,?,?,?,?,?)`);
  let n = 0;
  for (const lojaId of [lojas.recife, lojas.caruaru]) {
    const escala = lojaId === lojas.recife ? 1 : 0.68;
    for (let m = 2; m >= 0; m--) {
      const data = new Date(); data.setMonth(data.getMonth() - m); data.setDate(5);
      if (data > new Date()) continue;
      for (const [categoria, valor, descricao] of CATEGORIAS_DESPESA) {
        const v = Number((valor * escala * rnd(0.9, 1.12)).toFixed(2));
        const forma = ['energia', 'agua', 'internet'].includes(categoria) ? 'boleto'
                    : categoria === 'comissao' ? 'dinheiro' : 'pix';
        ins.run(lojaId, categoria, descricao, v, forma, data.toISOString().slice(0, 7),
                data.toISOString().slice(0, 10), dataISO(data));
        if (forma === 'dinheiro') {
          const saldo = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM cash_movements WHERE store_id = ?').get(lojaId).s;
          if (saldo >= v) {
            db.prepare(`INSERT INTO cash_movements(store_id,kind,amount,description,ref_type,created_at)
                        VALUES(?,'despesa',?,?,'despesa',?)`).run(lojaId, -v, descricao, dataISO(data));
          }
        }
        n++;
      }
    }
    // depositos periodicos para a matriz
    for (let s = 11; s >= 1; s--) {
      const data = new Date(Date.now() - s * 7 * 864e5);
      const saldo = db.prepare('SELECT COALESCE(SUM(amount),0) x FROM cash_movements WHERE store_id = ?').get(lojaId).x;
      const valor = Number((saldo * 0.6).toFixed(2));
      if (valor > 100) {
        db.prepare(`INSERT INTO cash_movements(store_id,kind,amount,description,ref_type,created_at)
                    VALUES(?,'deposito_matriz',?,?,'manual',?)`)
          .run(lojaId, -valor, 'Deposito semanal para a matriz', dataISO(data));
      }
    }
  }
  console.log(`  ${n} despesas e depositos semanais lancados`);
}

const lojas = {
  fabrica: db.prepare("SELECT id FROM stores WHERE code='FABRICA'").get()?.id,
  recife: db.prepare("SELECT id FROM stores WHERE code='RECIFE'").get()?.id,
  caruaru: db.prepare("SELECT id FROM stores WHERE code='CARUARU'").get()?.id
};

console.log('Gerando dados de demonstracao...');
await criarClientes(lojas);
simularOperacao(lojas);
gerarDespesasEDepositos(lojas);
console.log('Pronto. Rode "npm start" e entre no sistema para ver os relatorios.');
db.close();
