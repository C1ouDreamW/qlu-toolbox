#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
scratch=$(mktemp -d)
project="lumatile-check-$$"
shared=(docker compose -f "$root/deploy/server/compose.yaml" -p "$project")
compose=("${shared[@]}" -f "$root/deploy/server/compose.standalone.yaml")
root_command=()
if [[ $(id -u) != 0 ]]; then root_command=(sudo); fi

export LUMATILE_IMAGE="$project:local"
export LUMATILE_SECRET_KEY=local-compose-tests
export LUMATILE_DATA_ROOT="$scratch/data"
export LUMATILE_WEB_DIR="$scratch/web"
export LUMATILE_CONSOLE_DIR="$scratch/console"
export LUMATILE_STATIC_DIR="$scratch/static"
export LUMATILE_TLS_DIR="$scratch/tls"
export LUMATILE_ACME_DIR="$scratch/acme"
export LUMATILE_BIND_ADDRESS=127.0.0.1
export LUMATILE_PORTAL_PORT=0
export LUMATILE_HTTP_PORT=0
export LUMATILE_HTTPS_PORT=0
export LUMATILE_NGINX_LOG_DIR="$scratch/host-logs"
export LUMATILE_NGINX_LOG_GID=4

cleanup() {
  if [[ $1 != 0 ]]; then "${compose[@]}" logs --no-color; fi
  "${compose[@]}" down --volumes
  docker image rm "$LUMATILE_IMAGE" >/dev/null 2>&1 || true
  "${root_command[@]}" rm -rf -- "$scratch"
}
trap 'cleanup "$?"' EXIT

mkdir -p "$scratch/data/updates/"{android,releases/test} "$scratch/web/current" "$scratch/console/current" "$scratch/tls" "$scratch/acme" "$LUMATILE_NGINX_LOG_DIR"
chmod 0755 "$LUMATILE_NGINX_LOG_DIR"
"${root_command[@]}" install -d -o 10001 -g 10001 -m 0700 "$scratch/data/"{feedback,stats,stats/report,backups}
"${root_command[@]}" install -d -o 10001 -g 101 -m 2770 "$scratch/data/logs"
"${root_command[@]}" install -d -o 10001 -g 10001 -m 0755 "$scratch/static"
printf 'test apk payload' > "$scratch/data/updates/releases/test/test.apk"
printf '%s\n' '<!doctype html><title>LumaTile Compose smoke test</title>' > "$scratch/web/current/index.html"
printf '%s\n' '<!doctype html><title>LumaTile Console smoke test</title>' > "$scratch/console/current/index.html"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=lumatile.cn \
  -addext 'subjectAltName=DNS:lumatile.cn,DNS:www.lumatile.cn,DNS:api.lumatile.cn,DNS:console.lumatile.cn,DNS:lumatile.ishua.cloud' \
  -keyout "$scratch/tls/key.pem" -out "$scratch/tls/cert.pem" >/dev/null 2>&1
for domain in lumatile.cn lumatile.ishua.cloud; do
  directory="$scratch/tls/live/$domain"
  mkdir -p "$directory"
  ln -s ../../cert.pem "$directory/fullchain.pem"
  ln -s ../../key.pem "$directory/privkey.pem"
done

docker build -t "$LUMATILE_IMAGE" "$root/backend"

host_log="$LUMATILE_NGINX_LOG_DIR/lumatile.access.log"
printf '%s\n' '- - - [20/Nov/2026:00:00:00 +0800] "GET /beacon/desktop?id=host-test HTTP/1.1" 204 0' > "$host_log"
"${root_command[@]}" chgrp 4 "$host_log"
chmod 0640 "$host_log"
"${shared[@]}" up -d --wait --wait-timeout 90 portal
binding=$("${shared[@]}" port portal 8080)
test "$(curl --noproxy '*' -fsS -H 'Host: api.lumatile.cn' "http://$binding/healthz")" = ok
"${shared[@]}" run --rm --no-deps -T jobs python jobs.py collect --skip-github
"${shared[@]}" down

"${compose[@]}" up -d --wait --wait-timeout 90 nginx
binding=$("${compose[@]}" port nginx 443)
port=${binding##*:}
request() {
  local host=$1 path=$2
  shift 2
  curl --noproxy '*' -sS --cacert "$scratch/tls/cert.pem" --resolve "$host:$port:127.0.0.1" "$@" "https://$host:$port$path"
}

test "$(request api.lumatile.cn /healthz -f)" = ok
request console.lumatile.cn /admin/login/ -f -o /dev/null
request console.lumatile.cn / -f | grep -Fq '<title>LumaTile Console smoke test</title>'
request api.lumatile.cn /v1/auth/session -f -H 'Origin: https://console.lumatile.cn' -D "$scratch/console-headers" | grep -q '"csrfToken"'
grep -Eiq '^access-control-allow-origin: https://console\.lumatile\.cn[[:space:]]*$' "$scratch/console-headers"
grep -Eiq '^access-control-allow-credentials: true[[:space:]]*$' "$scratch/console-headers"
test "$(request api.lumatile.cn /v1/operations -o /dev/null -w '%{http_code}')" = 403
test "$(request console.lumatile.cn /v1/auth/session -o /dev/null -w '%{http_code}')" = 404
request lumatile.cn /download/ -f | grep -Fq '<title>LumaTile Compose smoke test</title>'
request api.lumatile.cn /android/distribution.json -f | grep -q '"website"'
test "$(request api.lumatile.cn /android/distribution.json -H 'Host: updates.lumatile.cn' -o /dev/null -w '%{http_code}')" = 404
check_apk() {
  local host
  for host in api.lumatile.cn lumatile.ishua.cloud; do
    test "$(request "$host" /releases/test/test.apk -H 'Range: bytes=0-3' -o /dev/null -w '%{http_code}')" = "$1"
  done
}
check_apk 503
printf '{"mode":"server"}\n' > "$scratch/data/updates/android/server.json"
request api.lumatile.cn /android/distribution.json -f | grep -q '"server"'
check_apk 206
rm "$scratch/data/updates/android/server.json"
check_apk 503
request lumatile.ishua.cloud '/beacon/android?id=compose-test' -f -o /dev/null

for _ in 1 2; do
  "${compose[@]}" run --rm --no-deps -T jobs python jobs.py collect --skip-github
done
"${compose[@]}" run --rm --no-deps -T jobs python jobs.py backup
"${compose[@]}" run --rm --no-deps -T jobs python -c '
import sqlite3
from pathlib import Path
with sqlite3.connect("/stats/stats.db") as database:
    assert database.execute("SELECT COUNT(*) FROM beacon_hits").fetchone() == (2,)
    assert database.execute("SELECT COUNT(*) FROM download_hits").fetchone() == (2,)
assert Path("/stats/report/stats.html").is_file()
assert len(list(Path("/backups").glob("*/portal.db"))) == 1
'
