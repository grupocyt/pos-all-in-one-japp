#!/usr/bin/env bash
# Restaura una copia de backup.sh sobre la base de Docker. ¡Sustituye los datos actuales!
# Uso: ./scripts/restore.sh ~/japp-backups/japp-20261014-2100.sql.gz
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"   # cron no trae la ruta de docker
cd "$(dirname "$0")/.."
[ -f "${1:-}" ] || { echo "Uso: $0 <fichero .sql.gz>"; exit 1; }
read -r -p "Se sustituirán TODOS los datos actuales por los de $1. Escribe SI para seguir: " ok
[ "$ok" = "SI" ] || { echo "Cancelado"; exit 1; }
docker compose stop api
gunzip -c "$1" | docker compose exec -T db psql -U japp -v ON_ERROR_STOP=1 -q japp
docker compose start api
echo "✓ restaurada $1"
