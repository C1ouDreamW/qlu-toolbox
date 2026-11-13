#!/usr/bin/env bash
set -euo pipefail

source_conf=$(cd "$(dirname "$0")" && pwd)/nginx/updates.conf
scratch=$(mktemp -d)
cleanup() {
  if [[ -f $scratch/nginx.pid ]]; then nginx -p "$scratch/" -c nginx.conf -s quit; fi
  rm -rf "$scratch"
}
trap cleanup EXIT
# 隔离测试使用 UNIX socket，避免占用宿主机站点端口。
chmod 755 "$scratch"
mkdir -p "$scratch/data/releases/test"
printf 'test apk payload' > "$scratch/data/releases/test/test.apk"
sed "s|/srv/data/lumatile/updates|$scratch/data|g" "$source_conf" > "$scratch/updates.conf"
cat > "$scratch/nginx.conf" <<CONF
pid nginx.pid;
error_log stderr;
events {}
http {
    access_log off;
    server {
        listen unix:$scratch/http.sock;
        server_name updates.lumatile.cn lumatile.ishua.cloud;
        include $scratch/updates.conf;
        location / { return 404; }
    }
}
CONF
nginx -p "$scratch/" -c nginx.conf
request() { curl --unix-socket "$scratch/http.sock" "$@"; }
request -fsS http://updates.lumatile.cn/android/distribution.json | grep -q '"website"'
check_apk() {
  local host=$1 expected=$2
  test "$(request -sS -H 'Range: bytes=0-3' -o /dev/null -w '%{http_code}' "http://$host/releases/test/test.apk")" = "$expected"
}
check_apk updates.lumatile.cn 503
check_apk lumatile.ishua.cloud 503
mkdir "$scratch/data/android"
printf '{"mode":"server"}\n' > "$scratch/data/android/server.json"
request -fsS http://updates.lumatile.cn/android/distribution.json | grep -q '"server"'
check_apk updates.lumatile.cn 206
check_apk lumatile.ishua.cloud 206
rm "$scratch/data/android/server.json"
check_apk updates.lumatile.cn 503
check_apk lumatile.ishua.cloud 503
