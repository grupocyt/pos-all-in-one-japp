#!/usr/bin/env bash
# Copia de la base que corre en Docker → ~/japp-backups/japp-AAAAMMDD-HHMM.sql.gz (guarda las 30 últimas).
# Uso: ./scripts/backup.sh          (desde japp-api)
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"   # cron no trae la ruta de docker
cd "$(dirname "$0")/.."
DEST="${BACKUP_DIR:-$HOME/japp-backups}"
mkdir -p "$DEST"
FILE="$DEST/japp-$(date +%Y%m%d-%H%M).sql.gz"
docker compose exec -T db pg_dump -U japp --clean --if-exists japp | gzip > "$FILE"
[ -s "$FILE" ] || { echo "✗ la copia salió vacía"; rm -f "$FILE"; exit 1; }
ls -1t "$DEST"/japp-*.sql.gz | tail -n +31 | while read -r old; do rm -f "$old"; done
echo "✓ copia en $FILE ($(du -h "$FILE" | cut -f1))"
