#!/bin/bash
set -euo pipefail

# ===================================================================================
# AUTODARTS TOUCH INSTALLATION SCRIPT
#
# This script installs and configures the Autodarts Touch application,
# along with its dependencies and system settings.
#
# Website: https://github.com/Kashiyyy/AutodartsTouch_Jules
#
# ===================================================================================

# --- Configuration
# This script can be run for a specific branch by passing its name as an argument.
# Example: sudo bash AutodartsTouchInstall.sh my-feature-branch
# Defaults to 'main' if no branch is specified.
BRANCH_NAME="${1:-main}"
GITHUB_REPO_URL="https://github.com/Kashiyyy/AutodartsTouch_Jules"
GITHUB_RAW_URL="${GITHUB_REPO_URL/github.com/raw.githubusercontent.com}/${BRANCH_NAME}"

# --- Environment
GUI_USER="${SUDO_USER:-$(logname)}"
HOME_DIR="$(eval echo "~$GUI_USER")"
APP_DIR="$HOME_DIR/AutodartsTouch"
START_SCRIPT="$APP_DIR/start.sh"
AUTOSTART_DESKTOP_DIR="$HOME_DIR/.config/autostart"
DESKTOP_FILE="$AUTOSTART_DESKTOP_DIR/AutodartsTouch.desktop"

# --- Helper Functions
print_header() {
  echo
  echo "================================================="
  echo " $1"
  echo "================================================="
}

print_info() {
  echo "INFO: $1"
}

print_success() {
  echo "SUCCESS: $1"
}

print_warning() {
  echo "WARNING: $1"
}

print_error() {
  echo "ERROR: $1" >&2
  exit 1
}

# Function to download a file and set ownership
download_file() {
  local url="$1"
  local dest="$2"
  print_info "Downloading file to $dest"
  if ! curl -sSL --fail -o "$dest" "$url"; then
    print_error "Failed to download file from $url. Please check the URL and your connection."
  fi
  chown "$GUI_USER:$GUI_USER" "$dest"
  chmod 644 "$dest"
}

# --- Start of Installation
print_header "Starting Autodarts Touch Setup"
print_info "Running as user: $GUI_USER"
print_info "Application will be installed in: $APP_DIR"
print_info "Installing from branch: $BRANCH_NAME"

# --- 1) System Update and Package Installation
print_header "Step 1: Updating System Packages"
print_info "Updating package lists..."
apt update
print_info "Upgrading installed packages... (This may take a while)"
apt upgrade -y
print_info "Installing required packages: curl, build-essential, alsa-utils..."
apt install -y curl build-essential alsa-utils || print_warning "Could not install all packages, but continuing."

# --- 2) Node.js Installation
print_header "Step 2: Installing Node.js"
# Remove older versions to prevent conflicts
print_info "Removing any old versions of Node.js..."
apt remove -y nodejs npm >/dev/null 2>&1 || true
apt purge -y nodejs npm >/dev/null 2>&1 || true
apt autoremove -y >/dev/null 2>&1 || true

if command -v node >/dev/null; then
  print_info "Node.js is already installed."
else
  print_info "Node.js not found. Installing Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || true
  apt install -y nodejs || true
fi

if ! command -v node >/dev/null; then
  print_error "Node.js installation failed. Please install it manually and re-run the script."
fi
print_success "Node.js is ready. Version: $(node -v)"

# --- 3) Autodarts Installation
print_header "Step 3: Installing Autodarts"
print_info "Running the official Autodarts installation script..."
if bash <(curl -sL get.autodarts.io) < /dev/null; then
  print_success "Autodarts installed successfully."
else
  print_error "Autodarts installation failed."
fi

# --- 4) Screen Rotation Configuration
print_header "Step 4: Configure Screen Rotation"
configure_rotation() {
  echo "Please choose your screen orientation from the options below."
  echo "This setting is for the physical display connected to your Raspberry Pi."
  echo
  echo "  1) Normal         (0 degrees, standard landscape)"
  echo "  2) Right-side up  (90 degrees, portrait)"
  echo "  3) Upside down    (180 degrees, inverted landscape)"
  echo "  4) Left-side up   (270 degrees, portrait)"
  echo "  5) Skip           (Do not change rotation)"
  echo

  local choice
  read -p "Enter your choice [1-5]: " choice

  local ROTATION_VALUE
  case $choice in
    1) ROTATION_VALUE=0 ;;
    2) ROTATION_VALUE=1 ;;
    3) ROTATION_VALUE=2 ;;
    4) ROTATION_VALUE=3 ;;
    5)
      print_info "Skipping screen rotation setup."
      return
      ;;
    *)
      print_warning "Invalid choice. Skipping screen rotation setup."
      return
      ;;
  esac

  local CONFIG_FILE="/boot/firmware/config.txt"
  if [ ! -f "$CONFIG_FILE" ]; then
    CONFIG_FILE="/boot/config.txt"
    if [ ! -f "$CONFIG_FILE" ]; then
      print_warning "Could not find config.txt. Skipping rotation setup."
      return
    fi
  fi

  print_info "Updating display rotation settings in $CONFIG_FILE..."
  # Remove existing rotation settings to avoid conflicts
  sed -i "/^display_hdmi_rotate=/d" "$CONFIG_FILE" 2>/dev/null || true
  sed -i "/^display_lcd_rotate=/d" "$CONFIG_FILE" 2>/dev/null || true

  # Add the new rotation setting for both HDMI and LCD displays
  echo "display_hdmi_rotate=$ROTATION_VALUE" >> "$CONFIG_FILE"
  echo "display_lcd_rotate=$ROTATION_VALUE" >> "$CONFIG_FILE"

  print_success "Screen rotation set. A reboot is required to apply the change."
}
configure_rotation

# --- 5) Argon One V5 Case Configuration
print_header "Step 5: Argon One V5 Case Setup"
configure_argon_one() {
  echo
  echo "This optional step enables the additional USB-A ports on the"
  echo "Argon One V5 case by modifying the boot configuration."
  echo

  local choice
  read -p "Do you have an Argon One V5 case and want to enable the extra USB ports? (y/N): " choice

  case "$choice" in
    [yY]|[yY][eE][sS])
      local CONFIG_FILE="/boot/firmware/config.txt"
      if [ ! -f "$CONFIG_FILE" ]; then
        CONFIG_FILE="/boot/config.txt"
        if [ ! -f "$CONFIG_FILE" ]; then
          print_warning "Could not find config.txt. Skipping Argon One setup."
          return
        fi
      fi

      local argon_line="dtoverlay=dwc2,dr_mode=host"
      if grep -q "^${argon_line}" "$CONFIG_FILE"; then
        print_info "Argon One V5 setting already exists in $CONFIG_FILE. No changes needed."
      else
        print_info "Enabling Argon One V5 USB ports..."
        echo "$argon_line" >> "$CONFIG_FILE"
        print_success "Argon One V5 USB ports enabled. A reboot is required."
      fi
      ;;
    *)
      print_info "Skipping Argon One V5 case setup."
      ;;
  esac
}
configure_argon_one

# --- 6) Download Autodarts Touch Application
print_header "Step 6: Downloading Autodarts Touch Files"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
chown -R "$GUI_USER:$GUI_USER" "$APP_DIR"

download_file "$GITHUB_RAW_URL/AutodartsTouch/package.json" "$APP_DIR/package.json"
download_file "$GITHUB_RAW_URL/AutodartsTouch/main.js" "$APP_DIR/main.js"
download_file "$GITHUB_RAW_URL/AutodartsTouch/preload.js" "$APP_DIR/preload.js"
download_file "$GITHUB_RAW_URL/AutodartsTouch/index.html" "$APP_DIR/index.html"
download_file "$GITHUB_RAW_URL/AutodartsTouch/AutodartsTouch.sh" "$START_SCRIPT"
chmod +x "$START_SCRIPT" # Make start script executable

# Create keyboard directory and download its files
mkdir -p "$APP_DIR/keyboard"
chown "$GUI_USER:$GUI_USER" "$APP_DIR/keyboard"
download_file "$GITHUB_RAW_URL/AutodartsTouch/keyboard/index.html" "$APP_DIR/keyboard/index.html"

# --- 7) Install Node.js Dependencies
print_header "Step 7: Installing Application Dependencies"
print_info "Running 'npm install'. This might take a moment..."
if sudo -u "$GUI_USER" bash -c "cd '$APP_DIR' && npm install --omit=dev"; then
  print_success "Application dependencies installed."
else
  print_error "Failed to install npm dependencies. Please check the logs."
fi

# --- 8) Configure Autostart
print_header "Step 8: Setting up Autostart"
print_info "Configuring the application to start automatically on boot."
mkdir -p "$AUTOSTART_DESKTOP_DIR"
cat > "$DESKTOP_FILE" <<DESK
[Desktop Entry]
Type=Application
Name=AutodartsTouch
Comment=Starts the Autodarts Touchscreen Interface
Exec=bash $START_SCRIPT
Terminal=false
X-GNOME-Autostart-enabled=true
DESK
chown "$GUI_USER:$GUI_USER" "$DESKTOP_FILE"
chmod 644 "$DESKTOP_FILE"
print_success "Autostart has been configured."

# --- 9) Finalizing Setup
print_header "Step 9: Finalizing Permissions"
chown -R "$GUI_USER:$GUI_USER" "$APP_DIR"
chmod -R u+rwX,go+rX,go-w "$APP_DIR"
print_success "File permissions have been set."

# --- Installation Complete
print_header "Setup Complete!"
echo
print_success "The Autodarts Touch application has been installed successfully."
print_info "It is configured to start automatically the next time you reboot."
echo
print_info "To start the application manually now, you can run:"
echo "  bash $START_SCRIPT"
echo
print_warning "A reboot is recommended to apply all changes (especially screen rotation)."
echo