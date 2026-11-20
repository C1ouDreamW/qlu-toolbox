#!/usr/bin/env bash
set -euo pipefail

# Verify browser access to the API before switching the public console symlink.
headers=$(curl -fsS --max-time 15 -o /dev/null -D - \
  -H 'Origin: https://console.lumatile.cn' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,x-csrftoken' \
  -X OPTIONS https://api.lumatile.cn/v1/auth/session)
if ! grep -Eiq '^Access-Control-Allow-Origin: https://console\.lumatile\.cn[[:space:]]*$' <<< "$headers" ||
   ! grep -Eiq '^Access-Control-Allow-Credentials: true[[:space:]]*$' <<< "$headers"; then
  printf '%s\n' '控制台 API 的跨域路由尚未就绪' >&2
  exit 1
fi
curl -fsS --max-time 15 -o /dev/null https://api.lumatile.cn/v1/auth/session

export LUMATILE_WEB_DIR="${LUMATILE_CONSOLE_DIR:-/srv/www/lumatile-console-ui}"
export LUMATILE_WEB_CHECK_URL=https://console.lumatile.cn/
export LUMATILE_WEB_CHECK_TITLE='<title>LumaTile 控制台</title>'
exec bash "$(dirname "$0")/deploy-web.sh" "$@"
