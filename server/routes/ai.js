import { isMaster, resolveStoreFilter } from '../lib/auth.js';
import { ok, str } from '../lib/http.js';
import { periodo } from './stats.js';
import { coletarDados, gerarInsights, relatorioTexto } from '../lib/insights.js';
import { narrativaAnthropic, iaDisponivel } from '../lib/anthropic.js';

export default {
  /** Insights acionaveis calculados a partir dos dados reais da operacao. */
  'GET /api/ia/insights': async (ctx) => {
    const stores = resolveStoreFilter(ctx.user, ctx.query.store_id);
    const { from, to } = periodo(ctx.query);
    const dados = coletarDados(stores, from, to);
    let insights = gerarInsights(dados);
    // gerentes nao veem analises derivadas do custo de compra
    if (!isMaster(ctx.user)) insights = insights.filter(i => i.chave !== 'margem_baixa');
    return ok(ctx.res, {
      periodo: dados.periodo,
      resumo: dados.atual,
      anterior: dados.anterior,
      insights,
      relatorio: relatorioTexto(dados, insights),
      ia_externa_disponivel: iaDisponivel()
    });
  },

  /**
   * Relatorio narrativo. Usa a analise local como base factual e, se houver
   * ANTHROPIC_API_KEY configurada, pede ao Claude que escreva o texto executivo.
   */
  'POST /api/ia/relatorio': async (ctx) => {
    const stores = resolveStoreFilter(ctx.user, ctx.query.store_id || ctx.body.store_id);
    const { from, to } = periodo({ from: ctx.body.from, to: ctx.body.to });
    const dados = coletarDados(stores, from, to);
    const insights = gerarInsights(dados);
    const base = relatorioTexto(dados, insights);
    const pergunta = str(ctx.body.pergunta);

    let narrativa = null, fonte = 'analise_local', erro = null;
    if (iaDisponivel()) {
      try {
        narrativa = await narrativaAnthropic({ dados, insights, pergunta });
        fonte = 'claude';
      } catch (e) {
        erro = e.message;
      }
    }
    return ok(ctx.res, {
      periodo: dados.periodo, resumo: dados.atual, insights,
      relatorio: base, narrativa, fonte, erro,
      ia_externa_disponivel: iaDisponivel()
    });
  }
};
