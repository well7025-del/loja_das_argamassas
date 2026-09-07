/**
 * Integracao OPCIONAL com a API da Anthropic.
 *
 * O ERP funciona 100% sem isto: o motor de insights local (lib/insights.js) ja
 * produz a analise e as recomendacoes. Quando existe ANTHROPIC_API_KEY no
 * ambiente e o pacote @anthropic-ai/sdk esta instalado, este modulo pede ao
 * Claude que escreva o relatorio executivo em cima dos MESMOS numeros — nunca
 * pedimos ao modelo que invente dados.
 */
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

export function iaDisponivel() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let clientePromise = null;
async function getClient() {
  if (!clientePromise) {
    clientePromise = (async () => {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      return new Anthropic();
    })().catch((e) => {
      clientePromise = null;
      throw new Error('SDK da Anthropic nao instalado. Rode: npm install @anthropic-ai/sdk');
    });
  }
  return clientePromise;
}

const SISTEMA = `Voce e o analista de negocios da Loja das Argamassas, uma revenda de argamassas e
materiais de acabamento com fabrica propria e lojas em Recife e Caruaru (Pernambuco, Brasil).

Escreva em portugues do Brasil, direto ao ponto, para um dono de pequeno negocio que tem pouco tempo.
Regras obrigatorias:
- Use SOMENTE os numeros que estao no JSON recebido. Nunca invente valores, produtos ou clientes.
- Aplique o principio de Pareto: destaque o pouco que explica muito.
- Estruture assim: (1) Como foi o periodo, em 3 frases. (2) O que esta funcionando. (3) O que esta
  drenando resultado. (4) As 3 acoes mais importantes para os proximos 15 dias, na ordem de impacto.
- Cada acao precisa ser concreta e executavel por um lojista (comprar, transferir, ligar, reajustar,
  disparar campanha), com o numero que a justifica.
- Valores em reais no formato R$ 0,00. Nada de jargao corporativo.`;

export async function narrativaAnthropic({ dados, insights, pergunta = '' }) {
  const client = await getClient();

  const payload = {
    periodo: dados.periodo,
    indicadores_periodo: dados.atual,
    indicadores_periodo_anterior: dados.anterior,
    ranking_produtos: dados.produtos.slice(0, 15),
    ranking_clientes: dados.clientes.slice(0, 10),
    despesas_por_categoria: dados.despesas,
    desempenho_por_loja: dados.porLoja,
    vendas_por_dia_da_semana: dados.porDiaSemana,
    caixa_por_loja: dados.caixa,
    vendas_sem_cliente: dados.semCliente,
    clientes_inativos: dados.inativos.slice(0, 10),
    analise_ja_calculada: insights.map(i => ({ tipo: i.tipo, titulo: i.titulo, acao: i.acao }))
  };

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: SISTEMA,
    messages: [{
      role: 'user',
      content: `Dados consolidados do ERP:\n\n${JSON.stringify(payload, null, 2)}\n\n` +
               (pergunta ? `Pergunta especifica do dono: ${pergunta}\n\n` : '') +
               'Escreva o relatorio executivo do periodo seguindo a estrutura pedida.'
    }]
  });

  const resposta = await stream.finalMessage();
  if (resposta.stop_reason === 'refusal') {
    throw new Error('O modelo nao pode responder a esta solicitacao.');
  }
  return resposta.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}
