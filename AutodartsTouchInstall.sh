#!/bin/bash
set -euo pipefail

# ===================================================================================
# GITHUB-BASED SETUP SCRIPT
#
# This script downloads the AutodartsTouch application files from a GitHub repository,
# installs dependencies, and configures the system for autostart.
#
# INSTRUCTIONS:
# 1. Upload your project files (main.js, preload.js, etc.) to a public GitHub repo.
# 2. **Replace the placeholder GITHUB_REPO_URL below with the URL to YOUR repository.**
# 3. Run this script as root / via sudo.
#
# Example: If your repo is at https://github.com/your-username/your-repo
#          set GITHUB_REPO_URL="https://github.com/your-username/your-repo"
# ===================================================================================

# -------------------------
# CONFIGURATION
# -------------------------
# This script can be run for a specific branch by passing the branch name as an argument.
# e.g., sudo bash setup_kiosk_from_github.sh my-feature-branch
# Defaults to 'main' if no branch is specified.

# Repository URL
GITHUB_REPO_URL="https://github.com/Kashiyyy/AutodartsTouch_Jules"

# Determine branch to use from the first script argument, default to 'main'
BRANCH_NAME="${1:-main}"

# Base URL for raw file content
GITHUB_RAW_URL="${GITHUB_REPO_URL/github.com/raw.githubusercontent.com}/${BRANCH_NAME}"


# -------------------------
# Environment Setup
# -------------------------
GUI_USER="${SUDO_USER:-$(logname)}"
HOME_DIR="$(eval echo "~$GUI_USER")"
APP_DIR="$HOME_DIR/AutodartsTouch"
START_SCRIPT="$APP_DIR/AutodartsTouch.sh"
AUTOSTART_LXDIR="$HOME_DIR/.config/lxsession/LXDE-pi"
AUTOSTART_FILE="$AUTOSTART_LXDIR/autostart"
AUTOSTART_DESKTOP_DIR="$HOME_DIR/.config/autostart"
DESKTOP_FILE="$AUTOSTART_DESKTOP_DIR/AutodartsTouch.desktop"

echo ">>> Setup starting for GUI-User: $GUI_USER"
echo ">>> Home: $HOME_DIR"
echo ">>> App-Folder: $APP_DIR"
echo ">>> Installing from branch: ${BRANCH_NAME}"
echo ">>> Downloading from: $GITHUB_RAW_URL/AutodartsTouch"
echo

# Function to download a file and set ownership
download_file() {
  local url="$1"
  local dest="$2"
  echo "Downloading $url -> $dest"
  if ! curl -sSL --fail -o "$dest" "$url"; then
    echo "ERROR: Failed to download file from $url"
    exit 1
  fi
  chown "$GUI_USER:$GUI_USER" "$dest"
  chmod 644 "$dest"
}

# -------------------------
# 0) Basic system packages (best-effort)
# -------------------------
apt update
apt upgrade -y
apt install -y curl build-essential alsa-utils || true

# -------------------------
# 1) Node.js (best-effort)
# -------------------------
# remove older node versions (best-effort)
apt remove -y nodejs npm || true
apt purge -y nodejs npm || true
apt autoremove -y || true

# Install Node 20 LTS (Nodesource) - if available
if ! command -v node >/dev/null; then
  echo "Node.js not found, attempting to install..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || true
  apt install -y nodejs || true
fi

echo ">>> Node: $(node -v 2>/dev/null || echo 'node missing')    npm: $(npm -v 2>/dev/null || echo 'npm missing')"
if ! command -v node >/dev/null; then
  echo "ERROR: Node.js installation failed. Please install it manually and re-run."
  exit 1
fi

# -------------------------
# 2) Install Autodarts
# -------------------------
echo ">>> Installing Autodarts..."
bash <(curl -sL get.autodarts.io)


# -------------------------
# 3) Create project dir & download files
# -------------------------
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
chown -R "$GUI_USER:$GUI_USER" "$APP_DIR"

# Download package.json first to install dependencies
download_file "$GITHUB_RAW_URL/AutodartsTouch/package.json" "$APP_DIR/package.json"

# -------------------------
# 4) Install npm dependencies
# -------------------------
echo ">>> Installing npm dependencies..."
sudo -u "$GUI_USER" bash -c "cd '$APP_DIR' && npm install --omit=dev >/dev/null 2>&1"
echo ">>> npm install complete."

# -------------------------
# 5) Download core application files
# -------------------------
download_file "$GITHUB_RAW_URL/AutodartsTouch/main.js" "$APP_DIR/main.js"
download_file "$GITHUB_RAW_URL/AutodartsTouch/preload.js" "$APP_DIR/preload.js"
download_file "$GITHUB_RAW_URL/AutodartsTouch/index.html" "$APP_DIR/index.html"

# -------------------------
# 6) Download keyboard files
# -------------------------
mkdir -p "$APP_DIR/keyboard"
chown "$GUI_USER:$GUI_USER" "$APP_DIR/keyboard"
download_file "$GITHUB_RAW_URL/AutodartsTouch/keyboard/index.html" "$APP_DIR/keyboard/index.html"

# -------------------------
# 7) Download start script
# -------------------------
download_file "$GITHUB_RAW_URL/AutodartsTouch/AutodartsTouch.sh" "$START_SCRIPT"
chmod 755 "$START_SCRIPT" # Make start script executable

# -------------------------
# 8) Autostart Configuration
# -------------------------
# Use a .desktop file for reliable startup with the GUI. This is the
# standard and most reliable method for GUI applications.
echo ">>> Setting up autostart..."
mkdir -p "$AUTOSTART_DESKTOP_DIR"
cat > "$DESKTOP_FILE" <<DESK
[Desktop Entry]
Type=Application
Name=AutodartsTouch
Exec=bash $START_SCRIPT
Terminal=false
X-GNOME-Autostart-enabled=true
DESK
chown "$GUI_USER:$GUI_USER" "$DESKTOP_FILE"
chmod 644 "$DESKTOP_FILE"

# -------------------------
# 9) Screen Rotation
# -------------------------
# Function to configure screen rotation
configure_rotation() {
  echo ">>> Configuring Screen Rotation..."
  echo "Please select the screen orientation:"
  echo "  1) Normal (0 degrees)"
  echo "  2) Right (90 degrees)"
  echo "  3) Inverted (180 degrees)"
  echo "  4) Left (270 degrees)"
  echo "  5) Skip"

  local choice
  read -p "Enter your choice [1-5]: " choice

  local ROTATION_VALUE
  case $choice in
    1) ROTATION_VALUE=0 ;;
    2) ROTATION_VALUE=1 ;;
    3) ROTATION_VALUE=2 ;;
    4) ROTATION_VALUE=3 ;;
    5)
      echo "Skipping screen rotation setup."
      return
      ;;
    *)
      echo "Invalid choice. Skipping screen rotation setup."
      return
      ;;
  esac

  # Path to the config file might differ, /boot/config.txt is common
  # but /boot/firmware/config.txt is used on newer Pi OS.
  local CONFIG_FILE="/boot/firmware/config.txt"
  if [ ! -f "$CONFIG_FILE" ]; then
    CONFIG_FILE="/boot/config.txt"
    if [ ! -f "$CONFIG_FILE" ]; then
      echo "ERROR: Could not find config.txt. Skipping rotation setup."
      return
    fi
  fi

  # Remove existing rotation settings to avoid conflicts
  if grep -q "^display_hdmi_rotate=" "$CONFIG_FILE"; then
    echo "Removing existing display_hdmi_rotate setting."
    sed -i "/^display_hdmi_rotate=/d" "$CONFIG_FILE"
  fi
    if grep -q "^display_lcd_rotate=" "$CONFIG_FILE"; then
    echo "Removing existing display_lcd_rotate setting."
    sed -i "/^display_lcd_rotate=/d" "$CONFIG_FILE"
  fi


  # Add the new rotation setting
  echo "Setting display_hdmi_rotate=$ROTATION_VALUE in $CONFIG_FILE"
  echo "display_hdmi_rotate=$ROTATION_VALUE" >> "$CONFIG_FILE"
    echo "display_lcd_rotate=$ROTATION_VALUE" >> "$CONFIG_FILE"

  echo "Screen rotation has been configured. A reboot is required for it to take effect."
}

# Call the function to configure rotation
configure_rotation

# -------------------------
# 10) Final ownership / perms
# -------------------------
chown -R "$GUI_USER:$GUI_USER" "$APP_DIR"
chmod -R u+rwX,go+rX,go-w "$APP_DIR"

echo
echo ">>> Setup Complete!"
echo "The application has been installed to: $APP_DIR"
echo "It is configured to start automatically on reboot."
echo
echo "To test it now, you can run:"
echo "  sudo -u $GUI_USER bash $START_SCRIPT"
echo
echo "IMPORTANT: The script used the repository URL '$GITHUB_REPO_URL'."
echo "If this is not correct, please edit this script and re-run it."
echo