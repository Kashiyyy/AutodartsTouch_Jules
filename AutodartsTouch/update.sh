#!/bin/bash
set -euo pipefail

# Change to a safe directory immediately to prevent CWD-related errors.
cd /tmp || exit 1

# This script is responsible for fetching the latest installer and running it.
# It is designed to be a stable entry point for the update process,
# ensuring that the application can reliably trigger its own update.

VERSION_TO_INSTALL="${1-}" # Default to empty if no argument is provided

# If a version is specified, use it to download the corresponding installer.
# Otherwise, default to the main branch to get the latest installer.
DOWNLOAD_TAG="${VERSION_TO_INSTALL:-main}"
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

# Run the installer script using pkexec, which provides a native graphical prompt.
echo "Executing the installer..."

# Check if pkexec is available.
if ! command -v pkexec &> /dev/null; then
    echo "ERROR: 'pkexec' is not installed. The graphical password prompt cannot be displayed."
    # Optionally, you could fall back to another method here, but for now, we'll exit.
    exit 1
fi

# Use pkexec to run the installer script.
# Polkit will handle the authentication prompt based on the policy file we installed.
# If the user cancels or fails authentication, pkexec will exit with a non-zero status.
if [ -n "$VERSION_TO_INSTALL" ]; then
    pkexec bash "$TEMP_INSTALLER" "$VERSION_TO_INSTALL"
else
    pkexec bash "$TEMP_INSTALLER"
fi

echo "--- Update process initiated. The application will restart upon completion. ---"

exit 0