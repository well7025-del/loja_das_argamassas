# Loja das Argamassas — ERP

Sistema de gestão web para a Loja das Argamassas: PDV, estoque multi-loja com fábrica,
financeiro, catálogo online, campanhas de WhatsApp e inteligência de negócio.

Construído no princípio de Pareto: cada tela mostra o que realmente muda o resultado
da empresa, e as operações do dia a dia (vender, repor, cobrar, analisar) são feitas
em poucos cliques — ou por voz.

---

## Como rodar

Só é preciso ter **Node.js 22.5 ou superior**. Não há dependências obrigatórias
para instalar — o banco é SQLite embutido no próprio Node.

```bash
npm start                 # sobe em http://localhost:3000
```

Comandos disponíveis:

| Comando | O que faz |
|---|---|
| `npm start` | Sobe o sistema (cria o banco e os dados iniciais na primeira execução) |
| `npm run dev` | Sobe com reinício automático ao salvar arquivos |
| `npm run demo` | Gera 90 dias de operação de exemplo (vendas, produção, despesas, clientes) |
| `npm run reset-db` | Apaga o banco para começar do zero |

### Acessos iniciais

| Perfil | E-mail | Senha |
|---|---|---|
| **Master** (vê todas as lojas) | `well7025@gmail.com` | `master@2026` |
| Responsável — Loja Recife | `recife@lojadasargamassas.com.br` | `recife@2026` |
| Responsável — Loja Caruaru | `caruaru@lojadasargamassas.com.br` | `caruaru@2026` |

> Troque as senhas no primeiro acesso em **Minha conta**. As senhas padrão também podem
> ser definidas antes da primeira execução pelas variáveis `MASTER_PASSWORD`,
> `RECIFE_PASSWORD` e `CARUARU_PASSWORD`.

### Variáveis de ambiente (todas opcionais)

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `DB_FILE` | `data/erp.db` | Caminho do banco |
| `SECURE_COOKIE` | — | `1` quando publicar atrás de HTTPS |
| `OFFLINE_CEP` | — | `1` desativa a consulta on-line de CEP (usa só a tabela interna) |
| `ANTHROPIC_API_KEY` | — | Ativa o relatório executivo escrito por IA |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Modelo usado no relatório por IA |

---

## Como colocar no ar

O guia passo a passo, em linguagem simples, está em
**[deploy/COMO-COLOCAR-NO-AR.md](deploy/COMO-COLOCAR-NO-AR.md)**. Em resumo:

- **Testar no seu computador**: instale o Node.js, baixe o projeto e rode `npm start`.
- **Colocar no ar de verdade** (recomendado): num servidor Ubuntu, o instalador faz tudo —
  Node.js, serviço que reinicia sozinho, endereço próprio e certificado HTTPS:

  ```bash
  git clone -b claude/argamassas-erp-web-vj4knb https://github.com/well7025-del/loja_das_argamassas.git /tmp/erp
  sudo bash /tmp/erp/deploy/instalar-ubuntu.sh erp.seudominio.com.br
  ```

  Rodar o mesmo comando de novo atualiza o sistema preservando banco, comprovantes e senhas.
- **Docker**: `docker compose up -d`, com volumes em `data/` e `uploads/`.

Backup automático diário: `deploy/backup.sh` (instruções no guia).

---

## Aplicativo da Loja Caruaru (celular único)

Além do sistema web, o projeto traz uma **versão enxuta para um celular da loja**,
em `public/loja/`. Ela roda dentro do próprio aparelho (IndexedDB), **funciona sem
internet**, instala como aplicativo pela tela inicial do Android e faz **backup no
Google Drive**.

Abra em `https://SEU-ENDERECO/loja/` — ou publique a pasta `public/loja/` sozinha em
qualquer hospedagem estática, pois não depende do servidor.

Tem PDV com voz e comprovante, estoque, caixa, despesas, clientes e resultado.
Não tem fábrica, multi-loja, usuários, mapa, catálogo nem campanhas — isso é do
sistema completo. Guia passo a passo:
**[deploy/COMO-USAR-O-APP-DA-LOJA.md](deploy/COMO-USAR-O-APP-DA-LOJA.md)**.

### Instalador para Android (.apk)

O mesmo aplicativo também existe como **instalador `.apk`**, que embute todo o
sistema e **não depende de servidor nem de domínio** — só do celular. O projeto
Android fica em `android/` e o arquivo é gerado pela automação em
`.github/workflows/apk.yml`, saindo na aba **Releases** do repositório.

Dentro do APK, o reconhecimento de voz e o backup usam recursos nativos do
Android (o WebView não tem a API de voz do navegador, e o Google recusa a tela
de login dele dentro de um WebView). Detalhes e passo a passo da instalação:
**[deploy/COMO-GERAR-O-APK.md](deploy/COMO-GERAR-O-APK.md)**.

---

## Perfis e permissões

| | Master | Gerente da loja |
|---|---|---|
| Ver dados de todas as lojas | ✅ | ❌ (só a própria) |
| Cadastrar produtos, custo e preço de venda | ✅ | ❌ |
| Ver custo e margem dos produtos | ✅ | ❌ |
| Cadastrar lojas e usuários | ✅ | ❌ |
| Lançar produção na fábrica e transferir estoque | ✅ | ❌ |
| Cancelar venda | ✅ | ❌ |
| PDV, clientes, caixa, despesas, catálogo, WhatsApp | ✅ | ✅ (na sua loja) |

O master pode cadastrar **quantas lojas quiser** em Configurações › Lojas e unidades,
escolhendo entre unidade do tipo **loja** (vende no PDV e tem caixa próprio) ou
**fábrica** (produz e abastece as lojas).

---

## Módulos

### PDV — vender em poucos cliques
- Grade de produtos com busca e filtro por categoria; um clique adiciona ao pedido.
- Cliente: seleciona um já cadastrado ou cadastra na hora (com CEP resolvido automaticamente).
- **Comando de voz**: `🎤 Voz` e fale *"10 argamassa AC 3"*, *"cinco rejunte branco"*,
  *"desconto 20"*, *"finalizar venda"*. Também dá para ditar o cadastro do cliente:
  *"nome João da Silva telefone 81 98888 7777 cep 51020 000"*.
- **Comprovante de pagamento**: tire a foto ou envie o print direto do celular — a imagem
  é reduzida no navegador antes do envio e fica anexada à venda.
- Ao concluir, o recibo pronto aparece com o botão **Enviar no WhatsApp** do cliente.

### Estoque, fábrica e transferências
- Posição por unidade, incluindo o **estoque da fábrica**.
- **Fábrica**: lançamento de produção (entra no estoque da fábrica) e **transferência**
  para as lojas — a saída da origem e a entrada no destino são registradas juntas.
- Ajustes manuais com motivo e histórico completo de movimentações.
- **Alerta de estoque mínimo**: todos os usuários que optarem por receber são notificados
  (sino no topo e painel inicial). O disparo é configurável em % do mínimo.

### Clientes
- Cadastro com CEP, telefone/WhatsApp, documento e observações; histórico de compras.
- Cadastro por voz e botão direto para conversar no WhatsApp.
- O CEP alimenta o mapa de densidade de vendas.

### Caixa por loja
- Cada loja tem o seu caixa. Toda venda em **dinheiro** entra automaticamente.
- Despesas pagas em dinheiro saem do caixa (o sistema impede deixá-lo negativo).
- Lançamentos de **depósito para a matriz**, sangria e suprimento.
- Aviso quando o saldo passa do limite configurado.

### Despesas
Aluguel, salário, comissão, internet, impostos, água, energia, telefone, frete,
combustível, manutenção, marketing, fornecedor, material de escritório, contabilidade
e outros — com forma de pagamento, competência e gráfico por categoria.

### Estatísticas
Faturamento por período (com comparação automática ao período anterior), ticket médio,
lucro bruto e margem, resultado após despesas, formas de pagamento, desempenho por loja,
movimento por hora, **ranking de produtos com curva ABC (Pareto)** e ranking de clientes.

### Mapa de vendas
Marcadores dos clientes que compraram no período, posicionados pelo CEP, com:
- grade de concentração de 1, 2 ou 5 km² e **densidade de clientes e faturamento por km²**;
- densidade calculada **por cidade** (evita distorção quando a operação atende regiões distantes);
- área de cobertura e raio médio a partir do centro da carteira.

A coordenada vem do CEP em três camadas: cache local → consulta on-line (ViaCEP + OpenStreetMap)
→ tabela de faixas de CEP embarcada. **Funciona mesmo sem internet**, com precisão de
bairro/região — e o sistema sempre informa qual precisão está usando.
Se o mapa do OpenStreetMap não carregar, é exibido um mapa simplificado em SVG com as
mesmas informações.

### Catálogo online
Página pública em `/catalogo` (e `/catalogo?loja=RECIFE` para mostrar a disponibilidade
de uma loja específica). Mostra foto, descrição e **preço de venda** — nunca o custo.
Na tela **Catálogo** do sistema, cada vendedor copia o link ou compartilha direto no WhatsApp.

### WhatsApp — campanhas agendadas
- Modelos prontos (promoção, produto novo, reativação, entrega na obra) com as variáveis
  `{{nome}}` e `{{loja}}`.
- Públicos: todos, por loja, quem comprou nos últimos X dias, ou **inativos** (reativação).
- Agendamento por data e hora: quando chega o horário, o sistema avisa e monta a **fila de
  envio** com a conversa de cada cliente já preenchida — um clique por cliente, sem
  API paga e sem risco de bloqueio por disparo automático em massa.

### Relatório e insights
O ERP analisa os próprios dados e produz recomendações acionáveis: tendência de
faturamento e ticket, curva ABC, ruptura iminente dos produtos campeões (com dias de
cobertura), produtos de margem baixa, capital parado, peso das despesas, concentração de
clientes, clientes inativos, comparativo entre lojas, melhor dia da semana e caixa acima
do limite. Cada ponto vem com a ação sugerida e o número que a justifica.

**Relatório escrito por IA (opcional).** Com `ANTHROPIC_API_KEY` no ambiente e o pacote
`@anthropic-ai/sdk` instalado (`npm install @anthropic-ai/sdk`), o botão *Gerar relatório
executivo* pede ao Claude que escreva o texto **sobre os mesmos números já calculados** —
o modelo nunca inventa dados. Sem a chave, o relatório é produzido pela análise interna.

---

## Arquitetura

```
server/
  index.js          servidor HTTP, roteamento da API e arquivos estáticos
  db.js             esquema SQLite (node:sqlite, sem dependências)
  seed.js           lojas, usuários e produtos iniciais
  demo.js           simulação de 90 dias de operação
  lib/
    auth.js         sessões, hash de senha (scrypt) e escopo de lojas por usuário
    stock.js        movimentações de estoque e lista de estoque mínimo
    notify.js       notificações de estoque baixo e de caixa
    geo.js          resolução de CEP em três camadas e cálculo de distância
    insights.js     motor de análise de negócio
    anthropic.js    integração opcional com a API da Anthropic
    files.js        gravação de comprovantes e fotos
    http.js         helpers de requisição/resposta
  routes/           auth, admin, products, stock, customers, sales,
                    finance, stats, campaigns, catalog, ai, notifications
public/
  index.html        aplicação (SPA)
  catalogo.html     catálogo público
  css/app.css       design system (azul, amarelo e verde)
  js/
    app.js          sessão, menu, rotas e estado global
    api.js          cliente HTTP
    ui.js           componentes, formatação, gráficos SVG e upload de imagem
    voice.js        reconhecimento de fala e interpretação dos comandos
    views/          uma tela por módulo
  loja/             aplicativo de celular da Loja Caruaru (offline, dados no aparelho)
    index.html      aplicação instalável (PWA)
    sw.js           service worker: abre sem internet
    js/db.js        banco local em IndexedDB
    js/backup.js    backup em arquivo e no Google Drive
    js/views/       uma tela por módulo
```

**Sem build e sem dependências obrigatórias**: o front é JavaScript de módulos nativos e
o back roda direto no Node. Isso mantém o sistema simples de hospedar, atualizar e auditar.

### Segurança
- Senhas com `scrypt` e sal por usuário; sessão em cookie `HttpOnly` + `SameSite=Lax`.
- Toda consulta é filtrada pelo escopo de lojas do usuário no **servidor** — esconder um
  menu no navegador nunca é a única barreira.
- Custo, margem e lucro são removidos da resposta da API para quem não é master.
- Uploads aceitam apenas imagem ou PDF, com limite de tamanho.
- Em produção, sirva atrás de HTTPS e defina `SECURE_COOKIE=1`.

### Backup
Todo o sistema vive em `data/erp.db` (mais as imagens em `uploads/`). Para fazer backup,
pare o servidor e copie as duas pastas.
