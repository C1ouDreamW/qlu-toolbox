#!/usr/bin/env bash
set -euo pipefail

image=${1:?用法：deploy-portal.sh IMAGE@sha256:DIGEST}
[[ $image =~ ^ghcr\.io/c1oudreamw/qlu-toolbox/server@sha256:[a-f0-9]{64}$ ]]
cd /srv/apps/lumatile
exec 9>.portal-deploy.lock
flock 9
previous=$(docker compose ps -q portal | xargs -r docker inspect --format '{{.Config.Image}}')
backup_dir=/srv/data/lumatile/backups
install -d -m 0700 "$backup_dir"
backup=$(mktemp -d "$backup_dir/pre-deploy.XXXXXXXX")
for database in portal feedback; do
  path="/srv/data/lumatile/feedback/$database.db"
  if [[ -f $path ]]; then sqlite3 "$path" ".backup '$backup/$database.db'"; fi
done
export LUMATILE_IMAGE="$image"
docker compose pull portal
if ! docker compose up -d --wait --wait-timeout 90 portal; then
  printf '部署验证失败。原镜像：%s；部署前备份：%s\n' "$previous" "$backup" >&2
  exit 1
fi
tmp=$(mktemp)
trap 'rm -f -- "$tmp"' EXIT
awk -v image="$image" 'BEGIN { print "LUMATILE_IMAGE=" image } !/^LUMATILE_IMAGE=/' .env > "$tmp"
install -m 0600 "$tmp" .env.new
mv -f .env.new .env
