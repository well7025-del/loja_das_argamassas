# Instalador (.apk) do aplicativo da Loja Caruaru

O aplicativo da loja existe em duas formas. As duas guardam os dados no próprio
celular e funcionam sem internet:

| | **APK instalado** | **Pelo navegador (PWA)** |
|---|---|---|
| Precisa de servidor/domínio? | **Não** | Sim (endereço com HTTPS) |
| Como instala | baixa o arquivo e toca nele | Chrome › Adicionar à tela inicial |
| Comando de voz | ✅ (reconhecedor do Android) | ✅ (Chrome) |
| Foto do comprovante | ✅ | ✅ |
| Backup no Google Drive | 1 toque, pelo menu de compartilhamento | automático, sem tocar em nada |
| Cópia diária no aparelho | ✅ automática, em Downloads | — |

O APK é o caminho certo para o celular da Caruaru: **não depende de nada além do
aparelho**.

---

## Baixar o instalador pronto

O arquivo é gerado pelo próprio repositório:

1. Abra **https://github.com/well7025-del/loja_das_argamassas/releases**
2. Baixe o `.apk` mais recente — **direto no navegador do celular da loja**.
3. Toque no arquivo baixado. O Android vai avisar que a instalação vem de fonte
   desconhecida: toque em **Configurações** › ative **Permitir desta fonte** ›
   volte e confirme. É só na primeira vez.
4. Abra o **Loja Caruaru** (ícone amarelo "LA") e faça a configuração inicial.

Se o repositório for privado, é preciso estar logado no GitHub com a sua conta
para a página de Releases aparecer.

> O Play Protect pode mostrar um aviso por ser um aplicativo fora da Play Store.
> Toque em **Mais detalhes › Instalar mesmo assim**. É esperado para um app de
> uso próprio.

---

## Gerar uma versão nova

Sempre que o sistema mudar, gere um APK novo:

1. Abra a aba **Actions** do repositório.
2. Escolha **Gerar APK da Loja Caruaru** na lista da esquerda.
3. Clique em **Run workflow** › **Run workflow**.
4. Em cerca de 3 minutos o arquivo aparece em **Releases**.

Também roda sozinho a cada alteração em `android/` ou `public/loja/`.

**Instalar por cima preserva os dados** da loja, porque todas as versões são
assinadas com a mesma chave. Mesmo assim, faça o backup antes de atualizar.

---

## Sobre a chave de assinatura

A chave está versionada em `android/app/loja-caruaru.jks` (senha `lojacaruaru`).

Isso é uma escolha deliberada: o Android só deixa instalar uma atualização por
cima quando a assinatura é a mesma. Se a chave mudasse a cada build, cada
atualização exigiria **desinstalar o aplicativo — o que apaga os dados da loja**.

Se preferir uma chave só sua, guarde-a nos segredos do repositório
(**Settings › Secrets and variables › Actions**) e ela passa a ter prioridade:

| Segredo | Conteúdo |
|---|---|
| `KEYSTORE_BASE64` | o arquivo `.jks` convertido: `base64 -w0 minhachave.jks` |
| `KEYSTORE_PASSWORD` | senha do keystore |
| `KEY_ALIAS` | nome da chave dentro do keystore |
| `KEY_PASSWORD` | senha da chave |

Guarde esse arquivo fora do celular e fora do repositório. **Perder a chave
significa não conseguir mais atualizar o aplicativo instalado.**

---

## Backup dentro do aplicativo instalado

O Google recusa a tela de autorização dele dentro de um aplicativo com WebView,
então o envio automático ao Drive (com login) só funciona quando o sistema é
aberto pelo navegador. No APK o desenho é outro — e, na prática, mais seguro:

- **Todo dia, sozinho:** o aplicativo grava uma cópia em
  `Downloads/LojaCaruaru/` no próprio celular. Não pede nada, não depende de
  internet, e a pasta sobrevive mesmo se o aplicativo for desinstalado.
- **Para mandar ao Drive:** *Mais › Ajustes › **Fazer backup agora*** → o menu de
  compartilhamento abre → toque em **Google Drive**. Dois toques.
- **Para restaurar:** *Ajustes › Restaurar* → escolha o arquivo (do Downloads ou
  baixado do Drive) → **Substituir tudo**.

Faça o envio ao Drive pelo menos uma vez por semana. A cópia no celular protege
contra erro de operação; só a cópia no Drive protege contra perder o aparelho.

---

## Compilar no seu computador (opcional)

Se preferir não usar o GitHub:

1. Instale o **Android Studio** (traz o SDK e o Java).
2. Abra a pasta `android/` do repositório.
3. Menu **Build › Build Bundle(s) / APK(s) › Build APK(s)**.
4. O arquivo sai em `android/app/build/outputs/apk/release/`.

Por linha de comando, com o Android SDK instalado:

```bash
cd android
./gradlew assembleRelease
```

---

## Se der problema

**"Aplicativo não instalado"** — quase sempre é uma versão antiga assinada com
outra chave. Faça o backup pelo aplicativo antigo, desinstale e instale a nova.

**A voz não funciona** — o reconhecimento é do Android. Confirme que o app
**Google** está instalado e atualizado, que o celular tem internet no momento da
fala, e que a permissão de microfone foi concedida (Configurações › Aplicativos ›
Loja Caruaru › Permissões).

**A câmera não abre no comprovante** — conceda a permissão de câmera no mesmo
lugar. O aplicativo pede na primeira vez que você toca em tirar a foto; se
recusar, é preciso liberar manualmente.

**O aplicativo abre em branco** — force o fechamento e abra de novo. Persistindo,
instale a versão mais recente por cima; os dados continuam.
