# Aplicativo da Loja Caruaru — celular único

Versão enxuta do sistema, feita para **um celular da loja**. Tem só o que o dia a dia
exige: vender, controlar estoque, caixa, despesas, clientes e ver o resultado.

**Os dados ficam dentro do próprio celular.** Não depende de servidor nem de internet:
a loja continua vendendo com o sinal caindo. Em troca, o **backup é obrigatório** —
sem ele, perder o celular é perder tudo.

---

## Instalar no celular

1. No celular da loja, abra o **Google Chrome** e vá no endereço do aplicativo:
   `https://SEU-ENDERECO/loja/`
2. Toque no menu do Chrome (⋮) → **Adicionar à tela inicial** → **Instalar**.
3. Pronto: vira um ícone amarelo "LA" como qualquer outro aplicativo, abre em tela
   cheia e funciona sem internet.

> **Precisa ser HTTPS** (endereço com cadeado). Sem isso o Android não instala o
> aplicativo e o Chrome bloqueia a câmera e o microfone. Se você seguiu o guia
> [COMO-COLOCAR-NO-AR.md](COMO-COLOCAR-NO-AR.md), já está tudo certo: o endereço é
> o seu domínio com `/loja/` no fim.

A pasta `public/loja/` é independente — se preferir, dá para publicá-la sozinha em
qualquer hospedagem de site estático (GitHub Pages, Netlify, Cloudflare Pages), sem
servidor nenhum.

### Primeira abertura

O aplicativo pergunta o nome da loja, o WhatsApp e se você quer já cadastrar a lista
de produtos de argamassa (recomendado — você ajusta preços e estoque depois).

Em seguida, vá em **Estoque** e lance a quantidade que existe hoje de cada produto,
usando **+ Entrada**, já informando o **custo real da última nota**. A partir daí o
estoque se atualiza sozinho a cada venda.

### Vindo do sistema antigo

Se você já usa outro sistema, dá para trazer clientes, produtos e o histórico de
vendas a partir dos relatórios em CSV. Veja
**[ferramentas/LEIA-ME.md](../ferramentas/LEIA-ME.md)**.

---

## O dia a dia

| Aba | Para quê |
|---|---|
| **Início** | Vendas do dia, saldo das contas, gráfico de 14 dias e o que está para repor |
| **Vender** | O PDV: toque nos produtos, escolha o pagamento e finalize |
| **Estoque** | Entrada de mercadoria com custo real, preços, mínimo e cadastro |
| **Contas** | Caixa, conta do PIX e conta dos cartões: saldos, transferências, receitas e despesas |
| **Mais** | Vendas, clientes, despesas, resultado, conferência do extrato, comissões, inventário, auditoria e ajustes |

**Vender é assim:** toque nos produtos (o número no canto mostra quantos entraram),
toque na barra azul **Ver pedido**, escolha o cliente se quiser, a forma de pagamento,
tire a foto do comprovante se for PIX, e **Finalizar**. O recibo aparece pronto com o
botão de enviar no **WhatsApp do cliente** — em texto ou em **PDF**.

As formas de pagamento são **dinheiro, PIX, débito e crédito**. Venda a prazo e boleto
saíram: o que não entra na conta no ato não é venda paga, é conta a receber, e
controlar isso pela metade dá mais prejuízo do que não controlar.

**Desconto por quantidade sai sozinho.** Se o produto tem faixas cadastradas
(*Estoque › produto › Editar › Desconto por quantidade*, por exemplo 5% acima de 50
sacos e 10% acima de 100), o PDV aplica a maior faixa que couber e mostra no pedido
quanto o cliente economizou. Ninguém precisa lembrar da tabela na hora da venda.

**Por voz:** toque em **🎤 Voz** e fale *"10 argamassa AC 3"*, *"cinco rejunte branco"*,
*"desconto 20"* ou *"finalizar"*. No cadastro de cliente também dá para ditar:
*"nome Maria Souza telefone 81 98888 7777"*. Funciona no Chrome, com internet.

## Contas: para onde vai o dinheiro de cada venda

O aplicativo já vem com três contas: **Caixa da loja** (dinheiro), **Conta PIX** e
**Conta Cartões**. Cada venda cai sozinha na conta da forma de pagamento usada —
vendeu no PIX, entra na conta do PIX; vendeu no crédito, entra na dos cartões.

Na aba **Contas** você vê o saldo de cada uma e o total, e tem três botões:

- **🔁 Transferir** — move dinheiro de uma conta para outra (depositou o caixa no
  banco, sacou do PIX). O total da loja não muda; muda só onde o dinheiro está.
- **📈 Receita** — entrada que não veio de uma venda (aluguel de andaime, por exemplo).
- **📉 Despesa** — saída de qualquer conta.

Dá para criar mais contas (uma segunda maquininha, a conta de outro banco) e
escolher quais formas de pagamento caem em cada uma. Cada forma de pagamento fica
em uma conta só — o aplicativo avisa se você tentar repetir.

**Primeira vez:** informe o saldo que cada conta tem hoje em
*Contas › tocar na conta › Editar conta › Saldo inicial*. Daí em diante o
aplicativo mantém sozinho.

## Comprovante com os dados do PIX

Em **Mais › Ajustes › Recebimento por PIX**, cadastre a chave uma vez (tipo, chave,
titular, banco). A partir daí o comprovante — na tela, no texto do WhatsApp e no PDF —
sai com um bloco de pagamento em que **a chave fica numa linha só**, para o cliente
copiar sem pegar texto em volta. Na tela há ainda o botão **📋 Copiar chave PIX**.

Por padrão a chave aparece nas vendas por PIX. Marcando *"Mostrar a chave em todo
comprovante"*, ela vai em todos.

Em **Mais › Ajustes › Dados da loja** ficam nome, endereço, WhatsApp e CNPJ, que
aparecem no cabeçalho do comprovante, dos relatórios e do catálogo.

## Alterar uma venda já lançada

Em **Mais › Vendas**, abra a venda e toque em **✏️ Alterar**. Dá para mudar
quantidade, tirar ou acrescentar item, mudar desconto, forma de pagamento e
observação. O estoque e o lançamento na conta são **refeitos** ao salvar, e a
alteração fica registrada com data e motivo — o motivo é obrigatório, e é ele que
aparece depois no relatório de auditoria.

Na mesma tela dá para **identificar ou cadastrar o cliente** de uma venda que saiu
sem cliente. A tela de vendas não mostra custo nem lucro: é a tela que o vendedor
usa na frente do cliente.

## Catálogo pelo WhatsApp

Em **Estoque › 📤 Catálogo**: **💬 Texto** manda a tabela de preços agrupada por
categoria direto na conversa, e **📄 PDF** gera a tabela com o cabeçalho da loja,
para mandar a clientes maiores.

## Custo real: o que faz o lucro ser verdade

Ao lançar a entrada de mercadoria (**Estoque › produto › + Entrada**), informe o
**custo unitário da nota**. O aplicativo recalcula o **custo médio** do produto
misturando o que já estava em estoque com o que acabou de chegar, e mostra na
hora como fica a margem.

Isso importa mais do que parece: sem ele, o "lucro bruto" do relatório sai de um
custo que alguém digitou uma vez e nunca mais atualizou. Quando o fornecedor
reajusta, o número continua bonito na tela e errado na realidade.

Marcando **"Lançar o pagamento numa conta"**, a compra também sai do saldo da
conta escolhida e entra no relatório como despesa de fornecedor.

## Imprimir o cupom

Funciona com **impressora térmica Bluetooth** (as de bobina 58 mm ou 80 mm,
padrão ESC/POS — as mais comuns no comércio).

1. Pareie a impressora nas **configurações de Bluetooth do celular** (uma vez só).
2. No aplicativo: **Mais › Ajustes › Impressora › Escolher impressora**.
3. Escolha a largura do papel e toque em **🖨️ Testar**.

Depois disso, o botão **🖨️ Imprimir** aparece ao fechar a venda e também no
histórico, em *Mais › Vendas*, para reimprimir uma segunda via.

> Se o teste sair com símbolos estranhos no lugar dos acentos, deixe ligada a
> opção **"Imprimir sem acentos"**. Muitas impressoras baratas não têm a tabela
> de caracteres do português.

**Despesa paga em dinheiro sai do caixa** — e o aplicativo avisa se isso deixar o
saldo negativo.

---

## Conferir o extrato do banco e da maquininha

**Mais › Conferência do extrato.** Exporte o extrato no aplicativo do banco ou da
maquininha em **OFX ou CSV**, escolha a conta e mande o arquivo. O aplicativo:

- casa cada **crédito** com as vendas daquela forma de pagamento, por data e valor;
- entende **depósito em lote** (a maquininha junta o dia num crédito só) e calcula
  a **taxa retida**, lançando-a como despesa quando você aprova;
- mostra as **vendas sem crédito** no extrato — as que faltam explicar;
- pré-lança as **outras entradas e saídas** como receita ou despesa, para você
  classificar e aprovar uma a uma. **Nada entra no financeiro sem sua aprovação.**

O arquivo é lido dentro do celular; nada é enviado para a internet.

> As janelas de conferência são diferentes por forma de pagamento, porque a
> liquidação é: PIX cai na hora (2 dias), débito no dia seguinte (5 dias) e crédito
> em torno de 30 dias (40 dias).

## Comissão por produto

A regra fica no cadastro: **Estoque › produto › Editar › Comissão do vendedor**,
em **% sobre a venda** ou **R$ por unidade**.

Em **Mais › Comissões**, escolha o período e veja quanto cada produto gerou.
**📄 Relatório em PDF** imprime a apuração para conferir e assinar, e
**💸 Lançar pagamento** joga o valor em Despesas, na categoria comissão. Vendas
canceladas ficam de fora da apuração.

## Ajustes extraordinários de estoque

Perda, avaria, devolução, bonificação, uso interno, acerto de inventário e balanço
não são venda nem compra — e não podem sumir dentro do saldo. Em
**Estoque › produto › ⚖️ Ajuste** você informa o motivo, a quantidade (ou o saldo
contado), o responsável e **anexa a foto do documento que autoriza**. Nos motivos
que pedem documento, o aplicativo avisa se ele não foi anexado.

A **mudança de preço de venda** (**Estoque › produto › 💲 Preço**) segue a mesma
regra: motivo, responsável e documento.

## Inventário para auditoria

**Mais › Inventário › Iniciar contagem.** A contagem é **cega**: o saldo do sistema
não aparece enquanto você conta, senão quem conta confirma o número em vez de contar.
Ao fechar, aparecem as divergências item a item, com o valor a custo, e cada
diferença vira um ajuste registrado. O **PDF da contagem** sai com sistema, contado,
diferença e valor, para assinar e arquivar.

## Relatórios de auditoria

**Mais › Auditoria**, com filtro de período. Sete relatórios em PDF:

| Relatório | O que responde |
|---|---|
| Vendas canceladas e alteradas | Quem mexeu numa venda depois de fechada, quando e por quê |
| Ajustes extraordinários de estoque | Toda perda e acerto, com documento — ou marcado em vermelho quando falta |
| Alterações de preço de venda | De quanto para quanto, por quem, com qual autorização |
| Vendas sem comprovante anexado | PIX e cartão sem o print do pagamento |
| Vendas não conferidas no extrato | O que ainda não foi casado com o banco |
| Razão das contas | Todo o movimento financeiro do período, conta por conta |
| Posição de estoque valorizada | Quanto vale o estoque a custo e a preço de venda |

Documentos anexados em despesas, receitas e transferências aparecem no próprio
lançamento — o ícone 📎 na lista indica quais têm.

---

## Backup — a parte mais importante

Em **Mais › Ajustes**, no alto da tela. Existem dois caminhos.

### Caminho simples (funciona sem configurar nada)

Toque em **Fazer backup agora**. O celular abre o menu de compartilhamento; escolha
**Google Drive** (ou Gmail, WhatsApp — o que preferir) e salve o arquivo.

Funciona sempre, mas depende de alguém lembrar de fazer.

### Caminho automático (recomendado)

Com o Google Drive ligado, o aplicativo envia o backup sozinho para uma pasta
**"Backups - Loja das Argamassas"** no Drive da loja, guardando as 12 cópias mais
recentes. Configura-se **uma vez**:

1. No computador, abra **console.cloud.google.com** com a **conta Google da loja** e
   crie um projeto (qualquer nome).
2. **APIs e serviços › Biblioteca** → procure **Google Drive API** → **Ativar**.
3. **Tela de permissão OAuth** → tipo **Externo** → preencha nome do app e e-mail →
   em **Usuários de teste**, adicione o e-mail da loja.
4. **Credenciais › Criar credenciais › ID do cliente OAuth** → tipo
   **Aplicativo da Web**.
5. Em **Origens JavaScript autorizadas**, coloque exatamente o endereço do
   aplicativo, sem barra no fim — por exemplo `https://erp.suaempresa.com.br`.
6. Copie o **ID do cliente** gerado.
7. No celular: **Ajustes › 🔗 Ligar o Drive** → cole o ID → **Salvar e testar** →
   autorize com a conta da loja.

Na primeira autorização o Google mostra um aviso de **"app não verificado"**. É
esperado para um aplicativo de uso próprio: toque em *Avançado* → *Acessar*.

> O aplicativo pede a permissão `drive.file`, que dá acesso **apenas aos arquivos que
> ele mesmo criou**. Ele não consegue ler o restante do Drive da loja.

Depois disso o backup sai sozinho na frequência escolhida (todo dia, por padrão),
sempre que o celular estiver com internet. Se a autorização expirar, o Google pede a
confirmação de novo — é só tocar.

### Backup só dos cadastros

O botão **📇 Backup só dos cadastros** gera um arquivo com **clientes, produtos,
contas e configuração — sem nenhuma venda e sem saldo de estoque**. Serve para abrir
outra loja, montar um segundo celular ou mandar a base para alguém sem entregar junto
o faturamento. Quem recebe restaura o arquivo e lança a entrada do estoque real.

### Trocar de celular ou recuperar dados

No celular novo: instale o aplicativo, abra **Ajustes › ↩️ Restaurar**, escolha o
arquivo do backup e confirme com a opção **Substituir tudo**. Se o Drive estiver
ligado, use **📂 Ver backups no Drive** e escolha a data — sem precisar do arquivo.

---

## Cuidados

- **Crie a senha do aplicativo** em Ajustes. Sem ela, quem pegar o celular vê o
  faturamento, o caixa e os custos da loja. Anote a senha: esquecendo, a única saída
  é reinstalar e restaurar o backup.
- **Confira o aviso do sino** no alto da tela: ele avisa quando o backup está atrasado
  e quando algum produto chegou ao estoque mínimo.
- **Um celular só.** Esta versão não sincroniza entre aparelhos — se duas pessoas
  usarem dois celulares, viram dois controles separados. Para várias lojas e vários
  usuários ao mesmo tempo, use o sistema completo (a versão web).
- **Não desinstale o aplicativo nem limpe os dados do Chrome** sem ter feito backup:
  isso apaga o banco local.

---

## O que ficou de fora (e por quê)

Esta versão é de **loja única**, então não tem fábrica, transferência entre lojas,
usuários com permissões, mapa de clientes, catálogo online publicado nem campanhas de
WhatsApp em massa — são recursos de quem administra a rede, não de quem opera o balcão.

Também não tem **venda a prazo e boleto**: pedido de contas a receber, cobrança e
inadimplência é um módulo inteiro, e meio módulo disso engana mais do que ajuda.

Tudo isso continua no sistema completo, que roda no navegador e enxerga as duas lojas:
veja o [README](../README.md).
