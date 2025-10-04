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

# Run the installer script, using Zenity to ask for the sudo password.
echo "Executing the installer..."

# Check if zenity is available, which is needed for the graphical password prompt.
if ! command -v zenity &> /dev/null; then
    echo "ERROR: 'zenity' is not installed. The graphical password prompt cannot be displayed."
    exit 1
fi

# Use zenity to graphically prompt the user for their password.
# This is necessary because the script is run from a non-terminal GUI application.
PASSWORD=$(zenity --password --title="Authentication Required" --text="Please enter your password to run the update." 2>/dev/null)

# Exit if the user cancelled the dialog (zenity returns exit code 1).
if [ $? -ne 0 ]; then
    echo "Update cancelled by user."
    exit 1
fi

# Run the installer with sudo.
# The -S flag tells sudo to read the password from standard input.
# The -p '' flag prevents sudo from issuing its own prompt on the command line.
if [ -n "$VERSION_TO_INSTALL" ]; then
    echo "$PASSWORD" | sudo -S -p '' bash "$TEMP_INSTALLER" "$VERSION_TO_INSTALL"
else
    echo "$PASSWORD" | sudo -S -p '' bash "$TEMP_INSTALLER"
fi

echo "--- Update process initiated. The application will restart upon completion. ---"

exit 0