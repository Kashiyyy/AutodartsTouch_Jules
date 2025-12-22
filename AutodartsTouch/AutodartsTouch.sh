#!/bin/bash
set -euo pipefail

export DISPLAY=:0
export XAUTHORITY="$HOME/.Xauthority"

# Get the directory where the script is located to ensure local dependencies are found
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR" || exit 1

# Start Electron by calling the executable directly from the local node_modules.
# This is more robust than using 'npx' and avoids path resolution issues.
exec ./node_modules/.bin/electron . --disable-gpu --no-sandbox
