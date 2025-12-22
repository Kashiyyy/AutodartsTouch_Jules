#!/bin/bash
set -euo pipefail

export DISPLAY=:0
export XAUTHORITY="$HOME/.Xauthority"

# Get the directory where the script is located to ensure local dependencies are found
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR" || exit 1

# Start electron as GUI user (npx uses local node_modules)
exec /usr/bin/env npx electron . --disable-gpu --no-sandbox
