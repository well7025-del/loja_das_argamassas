/* Menu "Mais": o que não cabe na barra de baixo. */
import { el, cartao } from '../ui.js';
import { estado } from '../app.js';
import { espacoUsado, listar } from '../db.js';
import { statusBackup } from '../backup.js';
import { tamanho, dataHora } from '../ui.js';

const ITENS = [
  { rota: 'vendas',    icone: '📄', titulo: 'Vendas',    texto: 'Histórico, comprovantes e reenvio de recibo' },
  { rota: 'clientes',  icone: '👥', titulo: 'Clientes',  texto: 'Cadastro e histórico de compras' },
  { rota: 'despesas',  icone: '📉', titulo: 'Despesas',  texto: 'Aluguel, energia, salário e o resto' },
  { rota: 'relatorio', icone: '📊', titulo: 'Resultado', texto: 'Faturamento, lucro e o que mais vende' },
  { rota: 'ajustes',   icone: '⚙️', titulo: 'Ajustes e backup', texto: 'Dados da loja, senha e cópia no Google Drive' }
];

export async function render(raiz) {
  const [backup, espaco, vendas] = await Promise.all([statusBackup(), espacoUsado(), listar('vendas')]);

  raiz.append(
    el('div', { class: 'cartao mb' }, el('div', { class: 'lista' }, ITENS.map(i =>
      el('a', { class: 'item', href: `#/${i.rota}`, style: { textDecoration: 'none', color: 'inherit' } }, [
        el('span', { style: { fontSize: '22px' }, text: i.icone }),
        el('div', { class: 'info' }, [
          el('div', { class: 'titulo', text: i.titulo }),
          el('div', { class: 'sub', text: i.texto })
        ]),
        el('span', { class: 'mudo', text: '›' })
      ])))),

    backup.atrasado
      ? el('a', { class: 'aviso aviso-amarelo', href: '#/ajustes', style: { display: 'block', textDecoration: 'none' } },
          backup.ultimo
            ? `⚠️ Último backup há ${backup.diasDesde} dia(s). Toque para fazer agora.`
            : '⚠️ Você ainda não fez backup. Toque para configurar — leva 1 minuto.')
      : el('div', { class: 'aviso aviso-verde' },
          `✅ Backup em dia — último em ${dataHora(backup.ultimo.em)} (${backup.ultimo.destino === 'drive' ? 'Google Drive' : 'arquivo'}).`),

    cartao('Sobre este aplicativo', el('div', { class: 'cartao-corpo pq' }, [
      el('p', { style: { marginTop: 0 }, text: `${estado.loja?.nome || 'Loja Caruaru'} — versão de loja única.` }),
      el('p', { text: 'Todos os dados ficam guardados neste celular. O aplicativo funciona sem internet; a internet só é usada para enviar o backup e abrir o WhatsApp.' }),
      el('p', { class: 'mudo', text: `${vendas.length} venda(s) registradas${espaco ? ` · ${tamanho(espaco.usado)} usados no aparelho` : ''}.` })
    ]))
  );
}
