#!/usr/bin/env bash
# Moves the notifier to a server prepared by candylario/infra: deploys a
# fresh stack there, stops the bot here, copies its database over and starts
# it there, so chats keep their links and read positions. Nothing keeps
# running here afterwards; the local copy stays as a backup.
#
#   ./move.sh deploy@SERVER
# shellcheck disable=SC2029 # $dir is meant to expand here, before ssh.
set -euo pipefail
host=${1:?usage: ./move.sh deploy@SERVER}
dir=/srv/notifier
cd "$(dirname "$0")"

./deploy.sh "$host"
ssh "$host" "cd $dir && docker compose stop notifier"
docker compose stop notifier
echo "Copying the database..."
docker compose exec -T postgres pg_dump -U notifier -d notifier --clean --if-exists | gzip |
  ssh "$host" "cd $dir && gunzip | docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U notifier -d notifier" >/dev/null
ssh "$host" "cd $dir && docker compose up -d --no-build"
docker compose down
echo "The notifier now runs on $host; nothing runs here. Logs: ssh $host 'cd $dir && docker compose logs -f notifier'"
