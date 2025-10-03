#!/bin/bash
set -euo pipefail

# This script is responsible for fetching the latest installer and running it.
# It is designed to be a stable entry point for the update process,
# ensuring that the application can reliably trigger its own update.

VERSION_TO_INSTALL="${1-}" # Default to empty if no argument is provided
INSTALLER_URL="https://raw.githubusercontent.com/Kashiyyy/AutodartsTouch/main/AutodartsTouchInstall.sh"
TEMP_INSTALLER="/tmp/AutodartsTouchInstall.sh"

echo "--- Starting AutodartsTouch Update ---"
echo "Target version/branch: ${VERSION_TO_INSTALL:-"Latest Release"}"

# Download the latest installer script from the main branch
echo "Downloading the latest installer from GitHub..."
if ! curl -fsSL "$INSTALLER_URL" -o "$TEMP_INSTALLER"; then
    echo "ERROR: Failed to download the installer script. Please check your internet connection."
    exit 1
fi

# Make the downloaded script executable
chmod +x "$TEMP_INSTALLER"

# Run the installer script, passing the version argument if it exists.
# The main installer will handle fetching the latest release if the argument is empty.
echo "Executing the installer..."
if [ -n "$VERSION_TO_INSTALL" ]; then
    bash "$TEMP_INSTALLER" "$VERSION_TO_INSTALL"
else
    bash "$TEMP_INSTALLER"
fi

echo "--- Update process initiated. The application will restart upon completion. ---"

exit 0