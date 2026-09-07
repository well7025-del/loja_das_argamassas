import { db, setSetting, getSetting } from './db.js';
import { hashPassword } from './lib/auth.js';

const CATEGORIAS = ['Argamassas', 'Rejuntes', 'Cimento e Cal', 'Gesso e Massas', 'Impermeabilizantes', 'Acessorios'];

const PRODUTOS = [
  // sku, nome, categoria, unidade, custo, venda, estoque_min
  ['ARG-ACI-20',  'Argamassa Colante AC-I 20kg',            'Argamassas',        'SC', 12.40, 19.90, 60],
  ['ARG-ACII-20', 'Argamassa Colante AC-II 20kg',           'Argamassas',        'SC', 15.80, 24.90, 60],
  ['ARG-ACIII-20','Argamassa Colante AC-III 20kg',          'Argamassas',        'SC', 22.50, 34.90, 40],
  ['ARG-POR-20',  'Argamassa para Porcelanato 20kg',        'Argamassas',        'SC', 24.90, 38.90, 40],
  ['ARG-ASS-20',  'Argamassa de Assentamento 20kg',         'Argamassas',        'SC', 10.20, 16.90, 50],
  ['ARG-REB-20',  'Argamassa de Reboco 20kg',               'Argamassas',        'SC',  9.80, 15.90, 50],
  ['ARG-CPI-20',  'Argamassa Contrapiso 20kg',              'Argamassas',        'SC', 11.60, 18.50, 40],
  ['REJ-BR-1',    'Rejunte Acrilico Branco 1kg',            'Rejuntes',          'UN',  3.90,  7.50, 80],
  ['REJ-CZ-1',    'Rejunte Acrilico Cinza 1kg',             'Rejuntes',          'UN',  3.90,  7.50, 80],
  ['REJ-FLEX-5',  'Rejunte Flexivel 5kg',                   'Rejuntes',          'UN', 17.40, 27.90, 30],
  ['CIM-CP2-50',  'Cimento CP-II 50kg',                     'Cimento e Cal',     'SC', 33.50, 42.90, 40],
  ['CAL-HID-20',  'Cal Hidratada 20kg',                     'Cimento e Cal',     'SC',  9.30, 14.90, 40],
  ['GES-COL-40',  'Gesso Cola 40kg',                        'Gesso e Massas',    'SC', 18.00, 28.90, 25],
  ['MAS-COR-25',  'Massa Corrida 25kg',                     'Gesso e Massas',    'BD', 42.00, 64.90, 20],
  ['IMP-MAN-18',  'Impermeabilizante Manta Liquida 18L',    'Impermeabilizantes','BD', 98.00, 149.90, 12],
  ['IMP-ADT-3.6', 'Aditivo Impermeabilizante 3,6L',         'Impermeabilizantes','UN', 21.50, 34.90, 20],
  ['ACE-DES-8',   'Desempenadeira Dentada 8mm',             'Acessorios',        'UN', 11.00, 21.90, 15],
  ['ACE-ESP-2',   'Espacador Cruzeta 2mm (pct 100)',        'Acessorios',        'UN',  4.20,  9.90, 30]
];

export function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM stores').get().n;
  if (count > 0) return false;

  const tx = db.prepare('SELECT 1');
  db.exec('BEGIN');
  try {
    const insStore = db.prepare(`INSERT INTO stores(name,code,kind,city,uf,address,phone,cep) VALUES(?,?,?,?,?,?,?,?)`);
    const fabricaId = Number(insStore.run('Fabrica / Matriz', 'FABRICA', 'fabrica', 'Recife', 'PE', 'Distrito Industrial', '(81) 3000-0000', '50000-000').lastInsertRowid);
    const recifeId  = Number(insStore.run('Loja Recife', 'RECIFE', 'loja', 'Recife', 'PE', 'Av. Central, 1000 - Recife/PE', '(81) 99000-0001', '50050-000').lastInsertRowid);
    const caruaruId = Number(insStore.run('Loja Caruaru', 'CARUARU', 'loja', 'Caruaru', 'PE', 'Av. Agamenon Magalhaes, 500 - Caruaru/PE', '(81) 99000-0002', '55010-000').lastInsertRowid);

    const insUser = db.prepare(`INSERT INTO users(name,email,phone,password_hash,role,store_id) VALUES(?,?,?,?,?,?)`);
    insUser.run(
      process.env.MASTER_NAME || 'Wellington (Master)',
      (process.env.MASTER_EMAIL || 'well7025@gmail.com').toLowerCase(),
      '', hashPassword(process.env.MASTER_PASSWORD || 'master@2026'), 'master', null);
    insUser.run('Responsavel Loja Recife', 'recife@lojadasargamassas.com.br', '',
      hashPassword(process.env.RECIFE_PASSWORD || 'recife@2026'), 'gerente', recifeId);
    insUser.run('Responsavel Loja Caruaru', 'caruaru@lojadasargamassas.com.br', '',
      hashPassword(process.env.CARUARU_PASSWORD || 'caruaru@2026'), 'gerente', caruaruId);

    const insCat = db.prepare('INSERT INTO categories(name) VALUES(?)');
    const catIds = {};
    for (const c of CATEGORIAS) catIds[c] = Number(insCat.run(c).lastInsertRowid);

    const insProd = db.prepare(`INSERT INTO products(sku,name,category_id,unit,cost_price,sale_price,min_stock,description)
                                VALUES(?,?,?,?,?,?,?,?)`);
    const insStock = db.prepare('INSERT INTO stock(product_id,store_id,qty) VALUES(?,?,?)');
    const insMove = db.prepare(`INSERT INTO stock_moves(product_id,store_id,kind,qty,ref_type,note) VALUES(?,?,?,?,?,?)`);

    for (const [sku, nome, cat, un, custo, venda, min] of PRODUTOS) {
      const pid = Number(insProd.run(sku, nome, catIds[cat], un, custo, venda, min, `${nome} - produto de linha da Loja das Argamassas.`).lastInsertRowid);
      const qFab = 400, qRec = 120, qCar = 90;
      insStock.run(pid, fabricaId, qFab);
      insStock.run(pid, recifeId, qRec);
      insStock.run(pid, caruaruId, qCar);
      insMove.run(pid, fabricaId, 'ajuste', qFab, 'seed', 'Estoque inicial da fabrica');
      insMove.run(pid, recifeId, 'ajuste', qRec, 'seed', 'Estoque inicial da loja');
      insMove.run(pid, caruaruId, 'ajuste', qCar, 'seed', 'Estoque inicial da loja');
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  if (getSetting('empresa') === null) {
    setSetting('empresa', {
      nome: 'Loja das Argamassas',
      slogan: 'Argamassas, rejuntes e materiais de acabamento',
      telefone: '(81) 99000-0001',
      whatsapp: '5581990000001',
      email: 'contato@lojadasargamassas.com.br',
      endereco: 'Recife e Caruaru - PE'
    });
  }
  if (getSetting('notificacoes') === null) {
    setSetting('notificacoes', { estoque_minimo: true, percentual_alerta: 100, alerta_caixa_alto: 3000 });
  }
  return true;
}
