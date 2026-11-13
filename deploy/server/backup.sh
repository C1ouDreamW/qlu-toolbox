#!/usr/bin/env bash
set -euo pipefail
umask 077

data=${LUMATILE_DATA_ROOT:-/srv/data/lumatile}
backup="$data/backups"
mkdir -p "$backup"
stage=$(mktemp -d "$backup/.backup.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
for path in feedback/feedback.db feedback/portal.db stats/stats.db; do
  if [[ -f $data/$path ]]; then
    target="$stage/${path##*/}"
    sqlite3 "$data/$path" ".backup '$target'"
    test "$(sqlite3 "$target" 'PRAGMA quick_check')" = ok
  fi
done
for path in stable/announcement.json alpha/announcement.json android/server.json; do
  if [[ -f $data/updates/$path ]]; then
    mkdir -p "$stage/${path%/*}"
    cp -- "$data/updates/$path" "$stage/$path"
  fi
done
compgen -G "$stage/*.db" >/dev/null
name=$(date -u +%Y%m%dT%H%M%SZ)
mv -T -- "$stage" "$backup/$name"
find "$backup" -maxdepth 1 -type d -name '20*T*Z' -mtime +14 -exec rm -rf -- {} +
