#!/usr/bin/env bash
set -euo pipefail
command -v docker >/dev/null || { echo '此检查需要 Docker；应用开发不依赖 Docker' >&2; exit 1; }
root=$(cd "$(dirname "$0")/.." && pwd)
fixture=$(mktemp -d)
container=''
cleanup() {
  if [ -n "$container" ]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  rm -rf "$fixture"
}
trap cleanup EXIT
mkdir -p "$fixture/alpha" "$fixture/stable" "$fixture/releases/android-alpha-v2.1.0-alpha.1"
printf '{"fixture":"alpha"}\n' > "$fixture/alpha/android.json"
printf '{"fixture":"stable"}\n' > "$fixture/stable/android.json"
printf 'synthetic APK serving fixture\n' > "$fixture/releases/android-alpha-v2.1.0-alpha.1/LumaTile-Alpha-Android-v2.1.0-alpha.1.apk"
chmod -R a+rX "$fixture"
container=$(docker run -d --rm --add-host feedback:127.0.0.1 -p 127.0.0.1::80 \
  -v "$root/deploy/update-source/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$fixture:/srv/updates:ro" nginx:stable-alpine)
port=$(docker port "$container" 80/tcp | sed -n 's/^127\.0\.0\.1://p')
origin="http://127.0.0.1:$port"
for attempt in 1 2 3 4 5; do
  if curl -fsS "$origin/healthz" >/dev/null; then break; fi
  sleep "$attempt"
done
for channel in stable alpha; do
  curl -fsS -D "$fixture/headers" "$origin/$channel/android.json" -o "$fixture/response"
  cmp "$fixture/$channel/android.json" "$fixture/response"
  rg -qi '^content-type: application/json' "$fixture/headers"
  rg -qi '^cache-control: no-cache' "$fixture/headers"
  rg -qi '^access-control-allow-origin: \*' "$fixture/headers"
done
curl -fsS -D "$fixture/headers" "$origin/releases/android-alpha-v2.1.0-alpha.1/LumaTile-Alpha-Android-v2.1.0-alpha.1.apk" -o "$fixture/response"
rg -qi '^content-type: application/vnd.android.package-archive' "$fixture/headers"
rg -qi '^cache-control: public, max-age=31536000, immutable' "$fixture/headers"
[ "$(curl -sS -o /dev/null -w '%{http_code}' "$origin/alpha/missing.json")" = 404 ]
echo 'PASS: isolated Stable / Alpha routes, JSON/APK MIME, cache, CORS and missing-file 404'
