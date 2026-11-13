#!/usr/bin/env bash
set -euo pipefail

source_dir=${1:?用法：deploy-web.sh 静态文件目录 commit}
revision=${2:?需要完整提交 SHA}
[[ $revision =~ ^[a-f0-9]{40}$ ]]
base=${LUMATILE_WEB_DIR:-/srv/www/lumatile}
mkdir -p "$base/releases"
exec 9>"$base/.deploy.lock"
flock 9
stage=$(mktemp -d "$base/releases/.stage.XXXXXXXX")
link="$stage.link"
trap 'rm -rf -- "$stage" "$link"' EXIT
cp -a "$source_dir/." "$stage/"
test -s "$stage/index.html"
test -s "$stage/app.mjs"
chmod 755 "$stage"
target="$base/releases/$revision"
if [[ -d $target ]]; then
  diff -qr "$stage" "$target"
else
  mv -- "$stage" "$target"
fi

previous=$(readlink "$base/current" || true)
switch() {
  ln -s -- "$1" "$link"
  mv -fT -- "$link" "$base/current"
}
switch "releases/$revision"
if [[ -n ${LUMATILE_WEB_CHECK_URL:-} ]] && ! curl -fsS --max-time 15 "$LUMATILE_WEB_CHECK_URL" | grep -Fq '<title>一格有光'; then
  if [[ -n $previous ]]; then switch "$previous"; else rm -- "$base/current"; fi
  exit 1
fi
