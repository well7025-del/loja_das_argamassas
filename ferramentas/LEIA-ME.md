# Importar os dados do sistema antigo

Converte os três relatórios em CSV num arquivo de backup que o aplicativo
restaura — clientes, produtos e o histórico de vendas.

```bash
node ferramentas/importar-csv.mjs Products.csv Customers.csv Sales.csv backup-importado.json
```

Depois, no celular: **Mais › Ajustes › ↩️ Restaurar** → escolha o arquivo →
**Substituir tudo**.

## Três coisas que o importador faz de propósito

**As vendas antigas não entram no saldo das contas.** O dinheiro daquelas vendas
já foi gasto, sacado ou transferido — jogá-lo nos saldos de hoje faria o
aplicativo mostrar um caixa que não existe. O histórico alimenta faturamento,
lucro, ticket médio e ranking; o saldo de cada conta você informa uma vez em
**Contas › tocar na conta › Editar › Saldo inicial**.

**O preço de cada item vem rateado pelo total da venda, não pela tabela de
hoje.** Os preços mudaram ao longo dos meses; usar a tabela atual reescreveria o
seu histórico. Assim, a soma dos itens fecha exatamente com o valor que você
cobrou.

**O custo sai do lucro registrado em cada venda** (custo = total − lucro), o que
preserva a margem histórica exata em vez de recalculá-la pelo custo atual.

## O que não vem nos relatórios

- **Estoque**: o relatório de produtos veio com estoque zerado. Faça uma
  contagem e lance em **Estoque › produto › + Entrada**, já informando o custo
  real da última nota — é isso que acerta o custo médio.
- **Despesas**: não há relatório de despesas para importar. O histórico de
  despesas começa do zero.
- **Estoque mínimo**: veio zerado. Defina nos produtos que não podem faltar,
  para o aplicativo avisar.
