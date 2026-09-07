#!/usr/bin/env bash
#
# Instalador do ERP da Loja das Argamassas em um servidor Ubuntu (22.04 ou 24.04).
#
#   sudo bash instalar-ubuntu.sh erp.suaempresa.com.br
#
# O script pode ser executado de novo a qualquer momento para atualizar o sistema:
# ele preserva o banco de dados, os comprovantes e as senhas ja definidas.

set -euo pipefail

DOMINIO="${1:-}"
REPO="${REPO_URL:-https://github.com/well7025-del/loja_das_argamassas.git}"
BRANCH="${REPO_BRANCH:-claude/argamassas-erp-web-vj4knb}"
DESTINO=/opt/argamassas-erp
USUARIO=erp

vermelho() { printf '\033[31m%s\033[0m\n' "$*"; }
verde()    { printf '\033[32m%s\033[0m\n' "$*"; }
azul()     { printf '\033[34m\n== %s ==\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { vermelho "Rode com sudo: sudo bash instalar-ubuntu.sh SEU_DOMINIO"; exit 1; }
[ -n "$DOMINIO" ]    || { vermelho "Informe o dominio: sudo bash instalar-ubuntu.sh erp.suaempresa.com.br"; exit 1; }

azul "1/7 Atualizando o servidor e instalando o basico"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates nginx ufw >/dev/null

azul "2/7 Instalando o Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
verde "   Node $(node -v)"

azul "3/7 Baixando o sistema"
id -u "$USUARIO" >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/$USUARIO --shell /usr/sbin/nologin "$USUARIO"
if [ -d "$DESTINO/.git" ]; then
  git -C "$DESTINO" fetch --quiet origin "$BRANCH"
  git -C "$DESTINO" checkout --quiet "$BRANCH"
  git -C "$DESTINO" reset --hard --quiet "origin/$BRANCH"
  verde "   Sistema atualizado (banco de dados e comprovantes preservados)"
else
  rm -rf "$DESTINO"
  git clone --quiet --branch "$BRANCH" "$REPO" "$DESTINO"
  verde "   Sistema instalado em $DESTINO"
fi
mkdir -p "$DESTINO/data" "$DESTINO/uploads"

azul "4/7 Definindo as senhas iniciais"
if [ ! -f "$DESTINO/.env" ]; then
  senha() { tr -dc 'A-Za-z2-9' </dev/urandom | head -c 12; }
  MASTER=$(senha); RECIFE=$(senha); CARUARU=$(senha)
  cat > "$DESTINO/.env" <<ENV
# Senhas usadas apenas na PRIMEIRA execucao, para criar os usuarios.
# Depois de entrar no sistema, troque as senhas em "Minha conta".
MASTER_PASSWORD=$MASTER
RECIFE_PASSWORD=$RECIFE
CARUARU_PASSWORD=$CARUARU
# Descomente e preencha para ativar o relatorio escrito por IA:
# ANTHROPIC_API_KEY=
ENV
  chmod 600 "$DESTINO/.env"
  NOVAS_SENHAS=1
else
  verde "   Arquivo .env ja existe, senhas mantidas"
  NOVAS_SENHAS=0
fi
chown -R "$USUARIO:$USUARIO" "$DESTINO"

azul "5/7 Colocando o sistema no ar"
install -m 644 "$DESTINO/deploy/argamassas-erp.service" /etc/systemd/system/argamassas-erp.service
systemctl daemon-reload
systemctl enable --quiet argamassas-erp
systemctl restart argamassas-erp
sleep 3
systemctl is-active --quiet argamassas-erp || { vermelho "O servico nao subiu. Veja o motivo com: journalctl -u argamassas-erp -n 40"; exit 1; }
verde "   Servico ativo"

azul "6/7 Configurando o endereco $DOMINIO"
sed "s/SEU_DOMINIO/$DOMINIO/g" "$DESTINO/deploy/nginx.conf" > /etc/nginx/sites-available/argamassas-erp
ln -sf /etc/nginx/sites-available/argamassas-erp /etc/nginx/sites-enabled/argamassas-erp
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null && systemctl reload nginx
ufw allow 'Nginx Full' >/dev/null 2>&1 || true
ufw allow OpenSSH      >/dev/null 2>&1 || true

azul "7/7 Emitindo o certificado HTTPS"
apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
if certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos --register-unsafely-without-email --redirect >/dev/null 2>&1; then
  verde "   HTTPS ativo em https://$DOMINIO"
else
  vermelho "   Nao foi possivel emitir o certificado agora."
  vermelho "   Confirme que o dominio $DOMINIO aponta para o IP deste servidor e rode:"
  vermelho "     sudo certbot --nginx -d $DOMINIO"
fi

echo
verde "==================== PRONTO ===================="
verde " Sistema:  https://$DOMINIO"
verde " Catalogo: https://$DOMINIO/catalogo"
if [ "$NOVAS_SENHAS" = "1" ]; then
  echo
  echo " Acessos criados (anote e troque no primeiro login):"
  echo "   Master  well7025@gmail.com                  $(grep MASTER_PASSWORD "$DESTINO/.env" | cut -d= -f2)"
  echo "   Recife  recife@lojadasargamassas.com.br     $(grep RECIFE_PASSWORD "$DESTINO/.env" | cut -d= -f2)"
  echo "   Caruaru caruaru@lojadasargamassas.com.br    $(grep CARUARU_PASSWORD "$DESTINO/.env" | cut -d= -f2)"
fi
echo
echo " Comandos uteis:"
echo "   sudo systemctl status argamassas-erp     ver se esta no ar"
echo "   sudo systemctl restart argamassas-erp    reiniciar"
echo "   sudo journalctl -u argamassas-erp -f     acompanhar os registros"
echo "   sudo bash $DESTINO/deploy/backup.sh      fazer backup agora"
verde "================================================"
