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
| **Mais** | Vendas, clientes, despesas, resultado e ajustes |

**Vender é assim:** toque nos produtos (o número no canto mostra quantos entraram),
toque na barra azul **Ver pedido**, escolha o cliente se quiser, a forma de pagamento,
tire a foto do comprovante se for PIX, e **Finalizar**. O recibo aparece pronto com o
botão de enviar no **WhatsApp do cliente**.

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
usuários com permissões, mapa de clientes, catálogo online nem campanhas de WhatsApp
em massa — são recursos de quem administra a rede, não de quem opera o balcão.

Tudo isso continua no sistema completo, que roda no navegador e enxerga as duas lojas:
veja o [README](../README.md).
