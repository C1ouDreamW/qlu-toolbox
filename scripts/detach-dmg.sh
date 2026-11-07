#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo 'Usage: bash scripts/detach-dmg.sh <mount-directory>' >&2
  exit 2
fi
# Keep the backing device identity even if a busy detach removes its mount path.
# The helper verifies the device inventory and never forces an unmount.
exec node "$(dirname "$0")/detach-dmg.mjs" "$1"
