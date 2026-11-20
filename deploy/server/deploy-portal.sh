#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 1 ]]; then
  printf '用法：deploy-portal.sh IMAGE@sha256:DIGEST\n' >&2
  exit 2
fi
image=$1
[[ $image =~ ^ghcr\.io/c1oudreamw/qlu-toolbox/server@sha256:[a-f0-9]{64}$ ]]
cd /srv/apps/lumatile
exec 9>.portal-deploy.lock
flock 9
previous=$(docker compose ps -q portal | xargs -r docker inspect --format '{{.Config.Image}}')
export LUMATILE_IMAGE="$image"
docker compose pull portal jobs
docker compose run --rm --no-deps -T jobs python jobs.py backup
if ! docker compose up -d --wait --wait-timeout 90; then
  printf '部署验证失败。原镜像：%s。部署前备份见上方输出。\n' "$previous" >&2
  exit 1
fi
tmp=$(mktemp)
trap 'rm -f -- "$tmp"' EXIT
awk -v image="$image" 'BEGIN { print "LUMATILE_IMAGE=" image } !/^LUMATILE_IMAGE=/' .env > "$tmp"
install -m 0600 "$tmp" .env.new
mv -f .env.new .env
