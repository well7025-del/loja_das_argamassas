// Leitura de extratos (OFX/CSV dos principais bancos e da maquininha) e conferência com as vendas.
// Rodar: npm test
import assert from 'node:assert/strict';
import { lerExtrato, lerArquivoExtrato, soNumero, conferir } from '../public/loja/js/conciliacao.js';

const ver = (nome, linhas) => console.log(`  ${nome.padEnd(34)} ${linhas.length} lanç.: ` +
  linhas.map(l => `${l.data.slice(5)} ${l.valor}`).join(' | '));

// números
for (const [txt, n] of [['1.234,56', 1234.56], ['-1.234,56', -1234.56], ['1,234.56', 1234.56], ['12.50', 12.5],
  ['(12,00)', -12], ['12,00 D', -12], ['1.234,56 C', 1234.56], ['R$ -5,00', -5], ['250,00-', -250], ['-12.50', -12.5],
  ['1.234', 1234], ['R$ 1.090', 1090], ['abc', NaN]]) {
  const r = soNumero(txt);
  assert.ok(Number.isNaN(n) ? Number.isNaN(r) : r === n, `${txt} → ${r}, esperado ${n}`);
}

// 1. Nubank conta (vírgula, valor com ponto decimal, UUID)
let l = lerExtrato(`Data,Valor,Identificador,Descrição
01/08/2026,1546.00,66b1a2c3-aaaa-bbbb-cccc-000000000001,Transferência recebida pelo Pix - JOAO CONSTRUTOR - •••.123.456-••
02/08/2026,-250.00,66b1a2c3-aaaa-bbbb-cccc-000000000002,Pagamento de boleto efetuado - NEOENERGIA
03/08/2026,99.90,66b1a2c3-aaaa-bbbb-cccc-000000000003,Transferência recebida pelo Pix - MARIA`);
ver('Nubank', l); assert.deepEqual(l.map(x => x.valor), [1546, -250, 99.9]); assert.match(l[0].descricao, /JOAO/);

// 2. Itaú (ponto e vírgula, coluna de saldo, linha de saldo do dia)
l = lerExtrato(`data;lançamento;ag./origem;valor (R$);saldos (R$)
01/08/2026;SALDO ANTERIOR;;;10.000,00
01/08/2026;PIX TRANSF JOAO C01/08;;1.546,00;11.546,00
02/08/2026;SISPAG CONTA LUZ;;-250,00;11.296,00
02/08/2026;SALDO DO DIA;;;11.296,00`);
ver('Itaú', l); assert.deepEqual(l.map(x => x.valor), [1546, -250]);

// 3. Banco do Brasil (Nº documento numérico ANTES do valor — o leitor antigo pegava ele)
l = lerExtrato(`"Data","Lançamento","Detalhes","N° documento","Valor","Tipo Lançamento"
"01/08/2026","Saldo Anterior","","0","10000,00",""
"01/08/2026","Pix - Recebido","01/08 14:31 JOAO CONSTRUTOR","20260801","1546,00","Entrada"
"02/08/2026","Pagamento de Boleto","NEOENERGIA PE","123456","250,00","Saída"
"31/08/2026","S A L D O","","0","11296,00",""`);
ver('Banco do Brasil', l); assert.deepEqual(l.map(x => x.valor), [1546, -250]); assert.equal(l[0].documento, '20260801');
assert.match(l[0].descricao, /Pix - Recebido — 01\/08 14:31 JOAO/);

// 4. Bradesco (colunas separadas de crédito e débito, cabeçalho depois de linhas de título)
l = lerExtrato(`Extrato de: Agência: 1234 Conta: 56789-0
Data;Histórico;Docto.;Crédito (R$);Débito (R$);Saldo (R$)
01/08/26;PIX RECEBIDO JOAO;1234567;1.546,00;;11.546,00
02/08/26;PAGTO ELETRON COBRANCA;7654321;;250,00;11.296,00
Total;;;1.546,00;250,00;`);
ver('Bradesco', l); assert.deepEqual(l.map(x => x.valor), [1546, -250]); assert.equal(l[0].data, '2026-08-01');

// 5. Caixa (valor sem sinal + coluna D/C)
l = lerExtrato(`"Conta";"Data_Mov";"Nr_Doc";"Historico";"Valor";"Deb_Cred"
"0001";"20260801";"000001";"CRED PIX";"1546.00";"C"
"0001";"20260802";"000002";"DEB AUT LUZ";"250.00";"D"`);
ver('Caixa (data compacta)', l);
// data compacta no CSV não é aceita como data por padrão (seria número de documento) — conferir abaixo

// 6. Inter / Mercado Pago / PagBank (tabulação e R$)
l = lerExtrato(`Data Lançamento\tHistórico\tDescrição\tValor\tSaldo
01/08/2026\tPix recebido\tJoão Construtor\tR$ 1.546,00\tR$ 11.546,00
02/08/2026\tPagamento\tNeoenergia\t-R$ 250,00\tR$ 11.296,00`);
ver('Inter (tab, R$)', l); assert.deepEqual(l.map(x => x.valor), [1546, -250]);

// 7. maquininha (vendas em lote, valor líquido)
l = lerExtrato(`Data da venda;Data do pagamento;Bandeira;Valor bruto;Taxa;Valor líquido
01/08/2026;02/08/2026;Visa Débito;300,00;-9,00;291,00`);
ver('Maquininha', l);

// 8. sem cabeçalho nenhum
l = lerExtrato(`01/08/2026;PIX RECEBIDO JOAO;1.546,00;11.546,00
02/08/2026;CONTA DE LUZ;-250,00;11.296,00`);
ver('Sem cabeçalho', l); assert.deepEqual(l.map(x => x.valor), [1546, -250]);

// 9. OFX SGML, valor com vírgula, DEBIT sem sinal, CRLF, Windows-1252
const ofx = 'OFXHEADER:100\r\nDATA:OFXSGML\r\nCHARSET:1252\r\n\r\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\r\n' +
  '<STMTTRN>\r\n<TRNTYPE>CREDIT\r\n<DTPOSTED>20260801120000[-3:BRT]\r\n<TRNAMT>1546,00\r\n<FITID>A1\r\n<MEMO>PIX RECEBIDO JOÃO\r\n</STMTTRN>\r\n' +
  '<STMTTRN>\r\n<TRNTYPE>DEBIT\r\n<DTPOSTED>20260802\r\n<TRNAMT>250.00\r\n<FITID>A2\r\n<MEMO>TARIFA\r\n</STMTTRN>\r\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
const bytes1252 = Uint8Array.from([...ofx].map(c => c === 'Ã' ? 0xC3 : c.charCodeAt(0)));
const texto = await lerArquivoExtrato(new File([bytes1252], 'extrato.ofx'));
l = lerExtrato(texto, 'extrato.ofx');
ver('OFX 1252, DEBIT sem sinal', l); assert.deepEqual(l.map(x => x.valor), [1546, -250]); assert.match(l[0].descricao, /JOÃO/);

// 10. OFX XML com tags fechadas e cartão de crédito
l = lerExtrato(`<?xml version="1.0"?><OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260805000000</DTPOSTED><TRNAMT>-80.00</TRNAMT><FITID>x</FITID><NAME>POSTO</NAME></STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`);
ver('OFX XML cartão', l); assert.deepEqual(l.map(x => x.valor), [-80]);

// 11. CSV em Windows-1252 com acento no cabeçalho
const csv1252 = 'Data;Hist\xF3rico;Valor\r\n01/08/2026;Pix recebido Jo\xE3o;1.546,00\r\n';
const t2 = await lerArquivoExtrato(new File([Uint8Array.from([...csv1252].map(c => c.charCodeAt(0)))], 'x.csv'));
l = lerExtrato(t2); ver('CSV 1252', l); assert.match(l[0].descricao, /João/);

// 12. CSV UTF-8 com BOM
const t3 = await lerArquivoExtrato(new File([new Uint8Array([0xEF, 0xBB, 0xBF]), 'Data;Descrição;Valor\n01/08/2026;Pix;10,00\n'], 'b.csv'));
assert.equal(lerExtrato(t3).length, 1);

// 13. arquivos que não são extrato
await assert.rejects(lerArquivoExtrato(new File(['%PDF-1.4 ...'], 'x.pdf')), /PDF/);
await assert.rejects(lerArquivoExtrato(new File([new Uint8Array([0x50, 0x4B, 3, 4])], 'x.xlsx')), /Excel/);
assert.throws(() => lerExtrato('nada a ver aqui\noutra linha', 'foto.jpg'), /Não encontrei lançamentos em foto\.jpg/);

// 14. conferência com venda dividida: só a parte em PIX casa com o crédito do PIX
const vendas = [
  { id: 1, codigo: 'CAR-00001', data: '2026-08-01T14:00:00Z', total: 1546, pagamentos: [{ forma: 'pix', valor: 1546 }] },
  { id: 2, codigo: 'CAR-00002', data: '2026-08-03T10:00:00Z', total: 150, pagamentos: [{ forma: 'pix', valor: 99.9 }, { forma: 'dinheiro', valor: 50.1 }] },
  { id: 3, codigo: 'CAR-00003', data: '2026-08-03T11:00:00Z', total: 40, pagamento: 'pix' },            // venda da versão anterior
  { id: 4, codigo: 'CAR-00004', data: '2026-08-03T12:00:00Z', total: 70, pagamento: 'pix', conciliada: true }
];
const extrato = lerExtrato(`Data,Valor,Descrição\n01/08/2026,1546.00,Pix JOAO\n03/08/2026,99.90,Pix MARIA\n03/08/2026,-12.00,Tarifa`);
const r = conferir(extrato, vendas, { conta: { chave: 'pix', recebe: ['pix'] } });
console.log('  conferência:', JSON.stringify(r.resumo), r.linhas.map(x => x.detalhe || x.status));
assert.equal(r.resumo.conciliados, 2);
assert.deepEqual(r.linhas[1].vendas, ['2:0']);
assert.match(r.linhas[1].detalhe, /parte PIX/);
assert.equal(r.resumo.vendasSemExtrato, 1);           // a venda 3 (antiga, R$ 40); a 4 já estava conferida
assert.equal(r.vendasSemExtrato[0].vendaId, 3);

console.log('extrato: todos os testes passaram');

// 15. maquininha: bruto casa com a venda e a diferença para o líquido é a taxa
{
  const linhas = lerExtrato(`Data da venda;Data do pagamento;Bandeira;Valor bruto;Taxa;Valor líquido
01/08/2026;02/08/2026;Visa Débito;300,00;-9,00;291,00`);
  assert.equal(linhas[0].valor, 300); assert.equal(linhas[0].taxaInformada, 9);
  const r2 = conferir(linhas, [{ id: 9, codigo: 'CAR-9', data: '2026-08-01T10:00:00Z', total: 300, pagamentos: [{ forma: 'debito', valor: 300 }] }],
    { conta: { chave: 'cartoes', recebe: ['debito', 'credito'] } });
  assert.equal(r2.resumo.conciliados, 1); assert.equal(r2.resumo.taxasTotal, 9);
  console.log('  maquininha:', r2.linhas[0].detalhe);
}
console.log('extrato (maquininha): ok');
