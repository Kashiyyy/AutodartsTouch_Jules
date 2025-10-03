#!/bin/bash
set -euo pipefail

# Change to a safe directory immediately to prevent CWD-related errors.
cd /tmp || exit 1

# This script is responsible for fetching the latest installer and running it.
# It is designed to be a stable entry point for the update process,
# ensuring that the application can reliably trigger its own update.

VERSION_TO_INSTALL="${1-}" # Default to empty if no argument is provided

# If a version is specified, use it as the download source.
# Otherwise, fetch the tag name of the latest release from GitHub.
if [ -n "$VERSION_TO_INSTALL" ]; then
    DOWNLOAD_TAG="$VERSION_TO_INSTALL"
else
    echo "INFO: No specific version provided. Fetching latest release from GitHub..."
    LATEST_TAG=$(curl -s https://api.github.com/repos/Kashiyyy/AutodartsTouch/releases/latest | grep '"tag_name":' | cut -d '"' -f 4)

    if [ -z "$LATEST_TAG" ]; then
        echo "ERROR: Could not fetch the latest release tag from GitHub. Cannot proceed." >&2
        exit 1
    fi
    DOWNLOAD_TAG="$LATEST_TAG"
fi
INSTALLER_URL="https://raw.githubusercontent.com/Kashiyyy/AutodartsTouch/${DOWNLOAD_TAG}/AutodartsTouchInstall.sh"
TEMP_INSTALLER="/tmp/AutodartsTouchInstall.sh"

# Ensure the temporary installer is cleaned up when the script exits.
trap 'rm -f "$TEMP_INSTALLER"' EXIT

echo "--- Starting AutodartsTouch Update ---"
echo "Target version/branch: ${VERSION_TO_INSTALL:-"Latest Release"}"

# Download the installer script from the appropriate branch/tag
echo "Downloading installer from tag/branch: ${DOWNLOAD_TAG}..."
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