#!/bin/bash
set -euo pipefail

export DISPLAY=:0
export XAUTHORITY="$HOME/.Xauthority"

cd "$HOME/AutodartsTouch" || exit 1

# Start electron as GUI user (npx uses local node_modules)
exec /usr/bin/env npx electron . --disable-gpu --no-sandbox
