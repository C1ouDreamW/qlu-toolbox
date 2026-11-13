#!/usr/bin/env bash
set -euo pipefail

bundle=${1:?用法：promote-android.sh 构件目录 stable或alpha}
channel=${2:?需要渠道}
[[ $channel == stable || $channel == alpha ]]
data=${LUMATILE_UPDATE_DIR:-/srv/data/lumatile/updates}
root=${LUMATILE_RELEASE_TOOLS:-/srv/apps/lumatile/release-tools}
shopt -s nullglob
releases=("$bundle"/releases/*)
[[ ${#releases[@]} == 1 ]]
release=${releases[0]}
tag=${release##*/}
[[ $tag =~ ^android-(alpha-)?v[0-9]+\.[0-9]+\.[0-9]+(-alpha\.[0-9]+)?$ ]]
manifest="$bundle/$channel/android.json"
apk=$(node --input-type=module - "$root" "$release" "$manifest" "$tag" "$channel" <<'JS'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const [root, release, input, tag, channel] = process.argv.slice(2)
const { verifyReleaseFiles, validateAndroidManifest } = await import(pathToFileURL(resolve(root, 'scripts/release-artifacts.mjs')))
const entries = await verifyReleaseFiles(release)
const manifest = validateAndroidManifest(JSON.parse(await readFile(input, 'utf8')), channel)
const url = new URL(manifest.apkUrl)
const file = url.pathname.split('/').at(-1)
const record = JSON.parse(await readFile(resolve(release, 'release-record.json'), 'utf8'))
if (manifest.tag !== tag || url.pathname !== `/releases/${tag}/${file}` ||
    !entries.includes(file) || record.platform !== 'android' || record.channel !== channel ||
    record.tag !== tag || record.version !== manifest.versionName || record.commit !== manifest.commit) {
  throw new Error('Android 产物、发布记录和渠道清单不一致')
}
process.stdout.write(file)
JS
)
mkdir -p "$data/releases"
exec 9>"$data/.android-deploy.lock"
flock 9
target="$data/releases/$tag"
stage=$(mktemp -d "$data/releases/.stage.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
if [[ -d $target ]]; then
  diff -qr "$release" "$target"
else
  cp -a "$release/." "$stage/"
  chmod 755 "$stage"
  mv -T -- "$stage" "$target"
fi
if [[ -f $data/android/server.json ]]; then
  downloaded="$stage/public.apk"
  mkdir -p "$stage"
  curl -fsS --max-time 90 "https://updates.lumatile.cn/releases/$tag/$apk" -o "$downloaded"
  cmp -- "$target/$apk" "$downloaded"
fi
node "$root/scripts/promote-update-manifest.mjs" android "$manifest" "$data" "$channel"
