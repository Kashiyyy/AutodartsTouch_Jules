#!/bin/bash
set -euo pipefail

export DISPLAY=:0
export XAUTHORITY="$HOME/.Xauthority"

# Get the absolute path of the directory where the script is located
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

# Change to the script's directory. This is crucial for npx to find the local node_modules.
cd "$SCRIPT_DIR" || exit 1

# Start electron as GUI user (npx uses local node_modules)
exec /usr/bin/env npx electron . --disable-gpu --no-sandbox
