#!/bin/bash
# This script is called by the Electron app, which will then quit.
# It waits a moment for the old app to exit cleanly, then starts the new one.

# The main script is in the same directory as this one.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
MAIN_SCRIPT="$SCRIPT_DIR/AutodartsTouch.sh"

# Wait for the old process to terminate. A simple sleep is the easiest way.
sleep 2

# Execute the main script.
# Using exec means this script's process is replaced by the main app's process.
# Redirecting output to a log file is good practice for debugging.
exec "$MAIN_SCRIPT" > "$SCRIPT_DIR/app_start.log" 2>&1