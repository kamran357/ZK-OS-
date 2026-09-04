#!/usr/bin/env bash
# Fangs.io — key a generated image to a transparent game sprite and register it.
# Usage:  ./tools/key-and-slice.sh <image> <sprite_name> [size] [--white|--rembg]
# Examples:
#   ./tools/key-and-slice.sh ~/Downloads/head.png head_0
#   ./tools/key-and-slice.sh ~/Downloads/logo.png ui_logo 256 --white
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMG="${1:?need an image path}"
NAME="${2:?need a sprite name (e.g. head_0)}"
SIZE="${3:-96}"
EXTRA="${4:-}"
# strip a numeric 3rd arg vs flag
case "$SIZE" in
  --*) EXTRA="$SIZE"; SIZE=96 ;;
esac
python3 "$DIR/tools/key_sprite.py" "$IMG" "$NAME" --size "$SIZE" ${EXTRA:+$EXTRA}
