#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo 'Usage: bash scripts/detach-dmg.sh <mount-directory>' >&2
  exit 2
fi
# Spotlight / diskimages-helper may briefly retain a verified read-only CI mount.
# Retry normal unmounts; keep a persistent busy-volume error visible to CI.
for attempt in 1 2 3 4 5; do
  if hdiutil detach "$1"; then exit 0; fi
  sleep "$attempt"
done
exit 1
