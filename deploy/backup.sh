#!/usr/bin/env bash
# Backup do ERP: copia o banco de dados e os comprovantes para /var/backups/argamassas-erp.
# Para rodar todo dia as 2h da manha:
#   sudo crontab -e
#   0 2 * * * /opt/argamassas-erp/deploy/backup.sh
set -euo pipefail

ORIGEM=${ORIGEM:-/opt/argamassas-erp}
DESTINO=${DESTINO:-/var/backups/argamassas-erp}
MANTER_DIAS=${MANTER_DIAS:-30}
CARIMBO=$(date +%Y-%m-%d_%H%M)

mkdir -p "$DESTINO"

# Copia consistente do banco mesmo com o sistema em uso
if command -v sqlite3 >/dev/null; then
  sqlite3 "$ORIGEM/data/erp.db" ".backup '$DESTINO/erp-$CARIMBO.db'"
else
  systemctl stop argamassas-erp 2>/dev/null || true
  cp "$ORIGEM/data/erp.db" "$DESTINO/erp-$CARIMBO.db"
  systemctl start argamassas-erp 2>/dev/null || true
fi

tar -czf "$DESTINO/uploads-$CARIMBO.tar.gz" -C "$ORIGEM" uploads

find "$DESTINO" -type f -mtime "+$MANTER_DIAS" -delete
echo "Backup concluido em $DESTINO (erp-$CARIMBO.db e uploads-$CARIMBO.tar.gz)"
