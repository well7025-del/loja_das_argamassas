# Como colocar o ERP no ar

Três caminhos, do mais simples ao definitivo. Escolha um.

---

## Caminho 1 — Ver funcionando no seu computador (10 minutos)

Serve para conhecer o sistema antes de decidir qualquer coisa. Roda só na sua máquina.

**1. Instale o Node.js**
Baixe em <https://nodejs.org> a versão **LTS** e instale clicando em "Avançar" até o fim.

**2. Baixe o sistema**
No GitHub do projeto, botão verde **Code** → **Download ZIP**. Descompacte, por exemplo, na Área de Trabalho.

**3. Abra o terminal na pasta**
- **Windows**: abra a pasta descompactada, clique na barra de endereço, digite `cmd` e tecle Enter.
- **Mac**: clique com o botão direito na pasta → Serviços → *Novo Terminal na Pasta*.

**4. Ligue o sistema**

```bash
npm start
```

Aparece `http://localhost:3000`. Abra esse endereço no navegador.

**Quer ver com dados de exemplo?** Antes do `npm start`, rode `npm run demo` — ele cria 90 dias
de vendas, produção, despesas e clientes para você navegar pelos relatórios. Para voltar ao
sistema vazio: `npm run reset-db`.

Para desligar, feche o terminal (ou tecle `Ctrl + C`).

> Nesse modo só o seu computador acessa. Serve para testar, não para as lojas usarem.

---

## Caminho 2 — Servidor próprio na nuvem (recomendado)

É o modo definitivo: as duas lojas acessam pelo navegador do celular ou do computador, o
catálogo fica público na internet e os dados ficam num servidor seu.

### O que você precisa contratar

**Um servidor Linux (VPS)** com Ubuntu 22.04 ou 24.04. O menor plano já sobra: 1 processador,
1 GB de memória, 20 GB de disco. Provedores comuns no Brasil: Hostinger, Contabo, Hetzner,
DigitalOcean, Vultr, Locaweb. Custa poucas dezenas de reais por mês — confirme o valor
atual no site do provedor.

**Um domínio**, por exemplo `erp.lojadasargamassas.com.br`. Se você já tem o domínio da
empresa, basta criar um subdomínio. No painel do domínio, crie um registro do tipo **A**
apontando para o **IP do servidor** que o provedor te deu.

### A instalação

Conecte no servidor (o provedor mostra como; no Windows use o PowerShell):

```bash
ssh root@IP_DO_SEU_SERVIDOR
```

Cole os dois comandos abaixo, trocando o domínio pelo seu:

```bash
git clone -b claude/argamassas-erp-web-vj4knb https://github.com/well7025-del/loja_das_argamassas.git /tmp/erp
sudo bash /tmp/erp/deploy/instalar-ubuntu.sh erp.lojadasargamassas.com.br
```

O script faz tudo sozinho: instala o Node.js, baixa o sistema, cria senhas aleatórias, coloca
o serviço no ar, configura o endereço e emite o **certificado HTTPS** (o cadeado do navegador).

No fim ele mostra os três acessos com as senhas geradas. **Anote e troque no primeiro login**,
em *Minha conta*.

### Ativar o backup automático

```bash
sudo crontab -e
```

Adicione esta linha no fim do arquivo, salve e feche:

```
0 2 * * * /opt/argamassas-erp/deploy/backup.sh
```

Todo dia às 2h da manhã o banco e os comprovantes são copiados para `/var/backups/argamassas-erp`,
guardando os últimos 30 dias. Vale a pena baixar essa pasta para um HD ou nuvem de vez em quando.

### Atualizar o sistema depois

Rode o mesmo instalador de novo. Ele atualiza o código e **preserva** banco, comprovantes e senhas:

```bash
sudo bash /opt/argamassas-erp/deploy/instalar-ubuntu.sh erp.lojadasargamassas.com.br
```

### Comandos do dia a dia

| Comando | O que faz |
|---|---|
| `sudo systemctl status argamassas-erp` | Ver se está no ar |
| `sudo systemctl restart argamassas-erp` | Reiniciar |
| `sudo journalctl -u argamassas-erp -f` | Acompanhar o que está acontecendo |
| `sudo bash /opt/argamassas-erp/deploy/backup.sh` | Fazer backup agora |

---

## Caminho 3 — Docker

Se o seu provedor ou a sua equipe já trabalha com contêineres:

```bash
docker compose up -d
```

O `docker-compose.yml` monta `./data` (banco) e `./uploads` (comprovantes) como volumes —
são essas duas pastas que precisam de backup. Defina as senhas iniciais no
`docker-compose.yml` **antes da primeira subida** e coloque um proxy com HTTPS na frente
(Nginx, Caddy ou Traefik), ativando `SECURE_COOKIE=1`.

---

## Perguntas frequentes

**Preciso instalar alguma coisa nos computadores e celulares das lojas?**
Não. Tudo funciona pelo navegador. No celular, abra o endereço e use "Adicionar à tela de
início" para virar um ícone como se fosse um aplicativo.

**Funciona se a internet da loja cair?**
Não — o sistema fica no servidor. É o mesmo caso de qualquer ERP na nuvem. O caixa e o
estoque continuam corretos assim que a conexão voltar.

**O comando de voz funciona em qualquer navegador?**
Use **Google Chrome** ou **Microsoft Edge**, no computador ou no Android. O recurso é do
navegador, não do sistema. Sem ele, tudo continua funcionando por toque e teclado.
Exige HTTPS — mais um motivo para o Caminho 2.

**Onde ficam meus dados?**
Em dois lugares dentro do servidor: `data/erp.db` (todo o sistema) e `uploads/`
(comprovantes e fotos). Guardar esses dois é guardar tudo.

**Como coloco o relatório escrito por IA para funcionar?**
No servidor:

```bash
cd /opt/argamassas-erp
sudo -u erp npm install @anthropic-ai/sdk
sudo nano .env          # adicione a linha ANTHROPIC_API_KEY=sk-ant-...
sudo systemctl restart argamassas-erp
```

A chave é criada em <https://console.anthropic.com>. Sem ela, o relatório continua sendo
gerado — pela análise interna do próprio sistema.
