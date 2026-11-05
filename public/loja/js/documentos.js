/* ============================================================
   Saída de arquivos: PDF do comprovante, relatórios e catálogo.

   Dentro do APK o arquivo é gravado em Downloads e o menu de
   compartilhamento abre (WhatsApp, Drive, e-mail). No navegador,
   cai no download normal.
   ============================================================ */
import { criarPdf, pdfParaBlob, pdfParaBase64 } from './pdf.js';
import { config } from './db.js';
import { pagamentosDe, nomeForma, descreverPagamento } from './regras.js';

const AZUL = [0.04, 0.24, 0.46];
const CINZA = [0.42, 0.49, 0.56];

export const dinheiroPdf = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',')
  .replace(/\B(?=(\d{3})+(?!\d)(?=,))/g, '.');
export const qtdPdf = (q) => Number(q) % 1 === 0 ? String(Number(q)) : Number(q).toFixed(2).replace('.', ',');
const dataPdf = (iso) => new Date(iso).toLocaleString('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
});
const soData = (iso) => new Date(iso).toLocaleDateString('pt-BR');

/* ---------------- Cabeçalho comum ---------------- */

function cabecalho(doc, loja, titulo, subtitulo = '') {
  doc.texto(loja.nome || 'Loja das Argamassas', { tamanho: 15, negrito: true, cor: AZUL }).pular(15);
  const contato = [loja.endereco, loja.whatsapp || loja.telefone].filter(Boolean).join(' · ');
  if (contato) doc.texto(contato, { tamanho: 9, cor: CINZA }).pular(12);
  doc.texto(titulo, { tamanho: 12, negrito: true, alinhamento: 'direita', yFixo: doc.posicao() + (contato ? 27 : 15) });
  if (subtitulo) doc.texto(subtitulo, { tamanho: 9, cor: CINZA, alinhamento: 'direita', yFixo: doc.posicao() + (contato ? 14 : 2) });
  doc.pular(6).linha({ espessura: 1, cor: [0.04, 0.24, 0.46] }).pular(18);
}

function rodape(doc, nota = '') {
  const y = doc.margem + 16;
  doc.texto(nota || `Emitido em ${dataPdf(new Date().toISOString())}`,
    { tamanho: 8, cor: CINZA, yFixo: y });
  doc.texto('Documento sem valor fiscal', { tamanho: 8, cor: CINZA, alinhamento: 'direita', yFixo: y });
}

/* ---------------- Comprovante de venda ---------------- */

/**
 * Comprovante em PDF com os dados de recebimento por PIX.
 * A chave vai em linha própria, para o cliente copiar sem pegar texto em volta.
 */
export function pdfComprovante(venda, loja = {}, pix = null) {
  const doc = criarPdf({ titulo: `Comprovante ${venda.codigo}` });
  cabecalho(doc, loja, 'COMPROVANTE DE VENDA', venda.codigo);

  doc.texto(`Data: ${dataPdf(venda.data)}`, { tamanho: 10 });
  doc.texto(venda.cancelada ? 'VENDA CANCELADA' : '', { tamanho: 10, negrito: true, alinhamento: 'direita', cor: [0.78, 0.16, 0.16] });
  doc.pular(14);
  if (venda.clienteNome) { doc.texto(`Cliente: ${venda.clienteNome}`, { tamanho: 10 }).pular(14); }

  doc.pular(6);
  doc.retangulo({ alturaCaixa: 18, deslocamento: -5 });
  doc.texto('PRODUTO', { tamanho: 9, negrito: true, x: doc.margem + 6 });
  doc.texto('QTD', { tamanho: 9, negrito: true, alinhamento: 'direita', x: 380 });
  doc.texto('UNITÁRIO', { tamanho: 9, negrito: true, alinhamento: 'direita', x: 460 });
  doc.texto('TOTAL', { tamanho: 9, negrito: true, alinhamento: 'direita', x: doc.largura - doc.margem - 6 });
  doc.pular(20);

  const VERDE = [0.12, 0.48, 0.30];
  for (const item of venda.itens) {
    doc.garantirEspaco(70, (d) => cabecalho(d, loja, 'COMPROVANTE DE VENDA', venda.codigo));
    const nome = item.nome.length > 52 ? item.nome.slice(0, 51) + '…' : item.nome;
    doc.texto(nome, { tamanho: 10, x: doc.margem + 6 });
    doc.texto(`${qtdPdf(item.qtd)} ${item.unidade || ''}`.trim(), { tamanho: 10, alinhamento: 'direita', x: 380 });
    doc.texto(dinheiroPdf(item.preco), { tamanho: 10, alinhamento: 'direita', x: 460 });
    doc.texto(dinheiroPdf(item.total), { tamanho: 10, negrito: true, alinhamento: 'direita', x: doc.largura - doc.margem - 6 });
    doc.pular(13);
    const notas = [];
    if (item.descontoQtd) notas.push(`${String(item.descontoQtd).replace('.', ',')}% por quantidade (tabela ${dinheiroPdf(item.precoTabela)})`);
    if (item.descontoItem > 0) {
      const regra = item.regraDesconto;
      notas.push(`desconto no item ${regra?.tipo === 'percentual' ? String(regra.valor).replace('.', ',') + '% ' : ''}- ${dinheiroPdf(item.descontoItem)}`);
    }
    if (notas.length) doc.texto(notas.join(' · '), { tamanho: 8, cor: VERDE, x: doc.margem + 14 }).pular(12);
    doc.pular(3);
  }

  doc.pular(4).linha().pular(16);
  const direita = doc.largura - doc.margem - 6;
  const totalLinha = (rotulo, valor, opcoes = {}) => {
    doc.texto(rotulo, { tamanho: 10, alinhamento: 'direita', x: 460, ...opcoes });
    doc.texto(valor, { tamanho: 10, alinhamento: 'direita', x: direita, ...opcoes }).pular(14);
  };
  const tabela = (venda.itens || []).reduce((a, i) => a + (Number(i.precoTabela) || Number(i.preco) || 0) * (Number(i.qtd) || 0), 0);
  const algumDesconto = (venda.descontoQuantidade || 0) + (venda.descontoItens || 0) + (venda.desconto || 0) > 0;
  if (algumDesconto) {
    totalLinha('Subtotal', dinheiroPdf(tabela));
    if (venda.descontoQuantidade > 0) totalLinha('Desconto por quantidade', '- ' + dinheiroPdf(venda.descontoQuantidade), { cor: VERDE });
    if (venda.descontoItens > 0) totalLinha('Desconto nos itens', '- ' + dinheiroPdf(venda.descontoItens), { cor: VERDE });
    if (venda.desconto > 0) totalLinha('Desconto no pedido', '- ' + dinheiroPdf(venda.desconto), { cor: VERDE });
  }
  doc.texto('TOTAL', { tamanho: 13, negrito: true, alinhamento: 'direita', x: 460 });
  doc.texto(dinheiroPdf(venda.total), { tamanho: 13, negrito: true, alinhamento: 'direita', x: direita, cor: AZUL }).pular(18);

  const pagamentos = pagamentosDe(venda).filter(p => p.valor > 0);
  if (pagamentos.length > 1) {
    doc.texto('Pagamento:', { tamanho: 10, negrito: true, alinhamento: 'direita', x: direita }).pular(13);
    for (const p of pagamentos) {
      doc.texto(`${nomeForma(p.forma)}  ${dinheiroPdf(p.valor)}`, { tamanho: 10, alinhamento: 'direita', x: direita }).pular(13);
    }
    doc.pular(3);
  } else {
    doc.texto(`Forma de pagamento: ${nomeForma(pagamentos[0]?.forma || venda.pagamento).toUpperCase()}`,
      { tamanho: 10, alinhamento: 'direita', x: direita }).pular(16);
  }

  if (venda.observacao) { doc.pular(6).texto(`Observação: ${venda.observacao}`, { tamanho: 9, cor: CINZA }).pular(14); }

  // bloco do PIX: quem chama decide se entra (venda com parte em PIX, ou "mostrar sempre")
  if (pix?.chave) {
    const parteEmPix = pagamentos.filter(p => p.forma === 'pix').reduce((a, p) => a + p.valor, 0);
    doc.pular(12);
    doc.retangulo({ alturaCaixa: 92, deslocamento: -78, cor: [0.95, 0.98, 0.96] });
    doc.texto('PAGAMENTO VIA PIX', { tamanho: 10, negrito: true, x: doc.margem + 10, cor: [0.12, 0.48, 0.30] }).pular(16);
    doc.texto(`Chave (${pix.tipo || 'PIX'}):`, { tamanho: 9, cor: CINZA, x: doc.margem + 10 }).pular(14);
    doc.texto(pix.chave, { tamanho: 13, negrito: true, x: doc.margem + 10 }).pular(16);
    if (pix.titular) { doc.texto(`Titular: ${pix.titular}`, { tamanho: 9, x: doc.margem + 10 }).pular(12); }
    if (pix.banco) { doc.texto(`Instituição: ${pix.banco}`, { tamanho: 9, x: doc.margem + 10 }).pular(12); }
    doc.texto(`Valor a pagar no PIX: ${dinheiroPdf(parteEmPix || venda.total)}`, { tamanho: 10, negrito: true, x: doc.margem + 10 }).pular(16);
  }

  rodape(doc);
  return doc.finalizar();
}

/* ---------------- Relatório em tabela ---------------- */

/**
 * Relatório genérico: colunas com largura e alinhamento, quebra de página
 * automática repetindo o cabeçalho. Serve para auditoria, comissões e catálogo.
 */
export function pdfTabela({ titulo, subtitulo, loja = {}, colunas, linhas, resumo = [], observacao = '', paisagem = false }) {
  const doc = criarPdf({ titulo, paisagem });
  const larguraUtil = doc.largura - doc.margem * 2;
  const soma = colunas.reduce((a, c) => a + c.peso, 0);
  let x = doc.margem;
  const posicoes = colunas.map(c => {
    const largura = larguraUtil * c.peso / soma;
    const info = { ...c, inicio: x, fim: x + largura };
    x += largura;
    return info;
  });

  const desenharCabecalho = (d) => {
    cabecalho(d, loja, titulo, subtitulo);
    d.retangulo({ alturaCaixa: 17, deslocamento: -5 });
    for (const c of posicoes) {
      d.texto(c.titulo, {
        tamanho: 8.5, negrito: true,
        alinhamento: c.alinhamento || 'esquerda',
        x: (c.alinhamento === 'direita') ? c.fim - 4 : c.inicio + 4
      });
    }
    d.pular(19);
  };
  desenharCabecalho(doc);

  for (const linha of linhas) {
    doc.garantirEspaco(30, desenharCabecalho);
    if (linha.separador) {
      doc.pular(2).linha().pular(12);
      doc.texto(linha.separador, { tamanho: 9.5, negrito: true, cor: AZUL, x: doc.margem + 4 }).pular(14);
      continue;
    }
    for (const c of posicoes) {
      const valor = linha[c.campo];
      if (valor === undefined || valor === null || valor === '') continue;
      const limite = Math.floor((c.fim - c.inicio) / 4.6);
      const texto = String(valor).length > limite ? String(valor).slice(0, limite - 1) + '…' : String(valor);
      doc.texto(texto, {
        tamanho: 8.5, negrito: Boolean(linha.destaque),
        cor: linha.cor || null,
        alinhamento: c.alinhamento || 'esquerda',
        x: (c.alinhamento === 'direita') ? c.fim - 4 : c.inicio + 4
      });
    }
    doc.pular(13);
  }

  if (resumo.length) {
    doc.garantirEspaco(40 + resumo.length * 14, desenharCabecalho);
    doc.pular(6).linha({ espessura: 1 }).pular(16);
    for (const item of resumo) {
      doc.texto(item.rotulo, { tamanho: 10, negrito: true, alinhamento: 'direita', x: doc.largura - doc.margem - 130 });
      doc.texto(item.valor, { tamanho: 10, negrito: true, alinhamento: 'direita', x: doc.largura - doc.margem, cor: item.cor || AZUL });
      doc.pular(15);
    }
  }
  if (observacao) { doc.pular(10).paragrafo(observacao, { tamanho: 8.5 }); }

  rodape(doc);
  return doc.finalizar();
}

/* ---------------- Entrega do arquivo ---------------- */

const dentroDoApp = () => Boolean(window.AndroidApp?.dentroDoApp?.());

/**
 * Entrega o PDF: no aplicativo abre o compartilhamento (WhatsApp na lista);
 * no navegador, baixa.
 */
export async function entregarPdf(bytes, nomeArquivo, { compartilhar = true } = {}) {
  if (dentroDoApp() && window.AndroidApp.salvarArquivo) {
    const resposta = String(window.AndroidApp.salvarArquivo(
      nomeArquivo, pdfParaBase64(bytes), 'application/pdf', compartilhar) || '');
    if (resposta.startsWith('erro:')) throw new Error(resposta.slice(5));
    return resposta.startsWith('salvo:') ? `Salvo em ${resposta.slice(6)}` : 'Arquivo pronto para enviar';
  }

  const blob = pdfParaBlob(bytes);
  const arquivo = new File([blob], nomeArquivo, { type: 'application/pdf' });
  if (compartilhar && navigator.canShare?.({ files: [arquivo] })) {
    await navigator.share({ files: [arquivo], title: nomeArquivo });
    return 'Compartilhado';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomeArquivo;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return `Arquivo ${nomeArquivo} baixado`;
}

export const nomeArquivoSeguro = (texto) => String(texto)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').toLowerCase();

/* ---------------- Texto de acompanhamento ---------------- */

/**
 * Dados do PIX que entram no comprovante desta venda: quando alguma parte foi
 * paga em PIX, ou quando a loja marcou "mostrar a chave em todo comprovante".
 */
export function pixParaVenda(venda, pixConfig) {
  if (!pixConfig?.chave) return null;
  const temPix = pagamentosDe(venda).some(p => p.forma === 'pix' && p.valor > 0);
  return temPix || pixConfig.sempre ? pixConfig : null;
}

const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtdBr = (v) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const pctBr = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const quandoBr = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Texto do comprovante para a tela e para o WhatsApp — o mesmo no PDV e no histórico. */
export function textoRecibo(venda, loja = {}, pix = null) {
  const pagamentos = pagamentosDe(venda).filter(p => p.valor > 0);
  const linhas = [
    `*${loja.nome || 'Loja das Argamassas — Caruaru'}*`,
    loja.endereco || null,
    loja.whatsapp || loja.telefone || null, '',
    `*Comprovante de venda ${venda.codigo}*`,
    `Data: ${quandoBr(venda.data)}`,
    venda.clienteNome ? `Cliente: ${venda.clienteNome}` : null, ''
  ];
  for (const i of venda.itens) {
    const notas = [];
    if (i.descontoQtd) notas.push(`−${pctBr(i.descontoQtd)} qtd`);
    if (i.descontoItem > 0) notas.push(i.regraDesconto?.tipo === 'percentual'
      ? `−${pctBr(i.regraDesconto.valor)} no item` : `−${brl(i.descontoItem)} no item`);
    linhas.push(`• ${qtdBr(i.qtd)}x ${i.nome} — ${brl(i.total)}${notas.length ? ` (${notas.join(', ')})` : ''}`);
  }
  linhas.push('');
  if (venda.descontoQuantidade > 0) linhas.push(`Desconto por quantidade: -${brl(venda.descontoQuantidade)}`);
  if (venda.descontoItens > 0) linhas.push(`Desconto nos itens: -${brl(venda.descontoItens)}`);
  if (venda.desconto > 0) linhas.push(`Desconto no pedido: -${brl(venda.desconto)}`);
  linhas.push(`*Total: ${brl(venda.total)}*`);
  if (pagamentos.length > 1) {
    linhas.push('Pagamento:');
    for (const p of pagamentos) linhas.push(`  ${nomeForma(p.forma)}: ${brl(p.valor)}`);
  } else {
    linhas.push(`Pagamento: ${nomeForma(pagamentos[0]?.forma || venda.pagamento)}`);
  }
  if (venda.observacao) linhas.push(`Obs.: ${venda.observacao}`);
  if (pix?.chave) {
    const parteEmPix = pagamentos.filter(p => p.forma === 'pix').reduce((a, p) => a + p.valor, 0);
    linhas.push('', '*Pagamento via PIX*', `Chave (${pix.tipo || 'PIX'}):`, pix.chave);
    if (pix.titular) linhas.push(`Titular: ${pix.titular}`);
    if (pix.banco) linhas.push(`Banco: ${pix.banco}`);
    if (parteEmPix && pagamentos.length > 1) linhas.push(`Valor no PIX: ${brl(parteEmPix)}`);
  }
  linhas.push('', 'Obrigado pela preferência!');
  return linhas.filter(l => l !== null).join('\n');
}

/** Mensagem que vai junto com o PDF no WhatsApp, já com a chave PIX. */
export async function textoComprovante(venda) {
  const loja = await config('loja', {});
  const pix = pixParaVenda(venda, await config('pix', null));
  const linhas = [
    `*${loja.nome || 'Loja das Argamassas'}*`,
    `Comprovante da venda ${venda.codigo}`,
    `Total: ${dinheiroPdf(venda.total)}`,
    `Pagamento: ${descreverPagamento(venda, dinheiroPdf)}`
  ];
  if (pix) {
    linhas.push('', '*Para pagar via PIX*', `Chave (${pix.tipo || 'PIX'}):`, pix.chave);
    if (pix.titular) linhas.push(`Titular: ${pix.titular}`);
  }
  linhas.push('', 'Obrigado pela preferência!');
  return linhas.join('\n');
}
