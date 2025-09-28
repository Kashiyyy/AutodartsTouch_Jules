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
BRANCH_NAME="${1:-main}"
GITHUB_REPO_URL="https://github.com/Kashiyyy/AutodartsTouch_Jules.git"

# --- Environment
GUI_USER="${SUDO_USER:-$(logname)}"
HOME_DIR="$(eval echo "~$GUI_USER")"
APP_DIR="$HOME_DIR/AutodartsTouch"
START_SCRIPT="$APP_DIR/AutodartsTouch.sh"
AUTOSTART_DESKTOP_DIR="$HOME_DIR/.config/autostart"
DESKTOP_FILE="$AUTOSTART_DESKTOP_DIR/AutodartsTouch.desktop"

# --- Global variables to store user choices
ROTATION_CHOICE=""
ARGON_CHOICE=""

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

# --- Start of Installation
print_header "Starting Autodarts Touch Setup"
print_info "Running as user: $GUI_USER"
print_info "Application will be installed in: $APP_DIR"
print_info "Installing from branch: $BRANCH_NAME"

# --- Step 1: Gather All User Input
print_header "Step 1: Configuration Questions"

# Ask about screen rotation
configure_rotation() {
  echo
  echo "Please choose your screen orientation from the options below."
  echo "This setting is for the physical display connected to your Raspberry Pi."
  echo
  echo "  1) Normal         (0 degrees, standard landscape)"
  echo "  2) Right-side up  (90 degrees, portrait)"
  echo "  3) Upside down    (180 degrees, inverted landscape)"
  echo "  4) Left-side up   (270 degrees, portrait)"
  echo "  5) Skip           (Do not change rotation)"
  echo

  read -p "Enter your choice for screen rotation [1-5]: " ROTATION_CHOICE < /dev/tty
}

# Ask about Argon One case
configure_argon_one() {
  echo
  echo "This optional step enables the additional USB-A ports on the"
  echo "Argon One V5 case by modifying the boot configuration."
  echo

  read -p "Do you have an Argon One V5 case and want to enable the extra USB ports? (y/N): " ARGON_CHOICE < /dev/tty
}

# Call the functions to gather input
configure_rotation
configure_argon_one

# --- Step 2: System Update and Package Installation
print_header "Step 2: Updating System Packages"
print_info "Updating package lists..."
apt update
print_info "Upgrading installed packages... (This may take a while)"
apt upgrade -y
print_info "Installing required packages: curl, git, build-essential, alsa-utils..."
apt install -y curl git build-essential alsa-utils || print_warning "Could not install all packages, but continuing."

# --- Step 3: Node.js Installation
print_header "Step 3: Installing Node.js"
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

# --- Step 4: Autodarts Installation
print_header "Step 4: Installing Autodarts"
print_info "Running the official Autodarts installation script..."
# We run the command in a subshell `()` to isolate it completely.
if (bash <(curl -sL get.autodarts.io) < /dev/null); then
  print_success "Autodarts installed successfully."
else
  print_error "Autodarts installation failed."
fi

# --- Step 5: Download Autodarts Touch Application
print_header "Step 5: Downloading Autodarts Touch Files"
rm -rf "$APP_DIR"

print_info "Cloning repository from $GITHUB_REPO_URL..."
TMP_DIR=$(mktemp -d)
if ! git clone --depth 1 --branch "$BRANCH_NAME" "$GITHUB_REPO_URL" "$TMP_DIR"; then
  print_error "Failed to clone the repository. Please check the URL and your connection."
fi

# The application files are in the 'AutodartsTouch' subdirectory of the repository.
# We move this subdirectory to the final destination.
mv "$TMP_DIR/AutodartsTouch" "$APP_DIR"

# Clean up the temporary directory.
rm -rf "$TMP_DIR"

chown -R "$GUI_USER:$GUI_USER" "$APP_DIR"
chmod +x "$START_SCRIPT"
print_success "Application files downloaded."


# --- Step 6: Install Node.js Dependencies
print_header "Step 6: Installing Application Dependencies"
print_info "Running 'npm install'. This might take a moment..."
if sudo -u "$GUI_USER" bash -c "cd '$APP_DIR' && npm install --omit=dev"; then
  print_success "Application dependencies installed."
else
  print_error "Failed to install npm dependencies. Please check the logs."
fi

# --- Step 7: Apply System Configurations
print_header "Step 7: Applying System Configurations"

# Apply screen rotation
ROTATION_VALUE=""
case $ROTATION_CHOICE in
  1) ROTATION_VALUE=0 ;;
  2) ROTATION_VALUE=1 ;;
  3) ROTATION_VALUE=2 ;;
  4) ROTATION_VALUE=3 ;;
esac

if [ -n "$ROTATION_VALUE" ]; then
  CONFIG_FILE="/boot/firmware/config.txt"
  if [ ! -f "$CONFIG_FILE" ]; then
    CONFIG_FILE="/boot/config.txt"
  fi
  if [ -f "$CONFIG_FILE" ]; then
    print_info "Updating display rotation settings in $CONFIG_FILE..."
    sed -i "/^display_hdmi_rotate=/d" "$CONFIG_FILE" 2>/dev/null || true
    sed -i "/^display_lcd_rotate=/d" "$CONFIG_FILE" 2>/dev/null || true
    echo "display_hdmi_rotate=$ROTATION_VALUE" >> "$CONFIG_FILE"
    echo "display_lcd_rotate=$ROTATION_VALUE" >> "$CONFIG_FILE"
    print_success "Screen rotation set. A reboot is required to apply the change."
  else
    print_warning "Could not find config.txt. Skipping rotation setup."
  fi
else
  print_info "Skipping screen rotation setup as requested."
fi

# Apply Argon One config
case "$ARGON_CHOICE" in
  [yY]|[yY][eE][sS])
    CONFIG_FILE="/boot/firmware/config.txt"
    if [ ! -f "$CONFIG_FILE" ]; then
      CONFIG_FILE="/boot/config.txt"
    fi
    if [ -f "$CONFIG_FILE" ]; then
      argon_line="dtoverlay=dwc2,dr_mode=host"
      if grep -q "^${argon_line}" "$CONFIG_FILE"; then
        print_info "Argon One V5 setting already exists. No changes needed."
      else
        print_info "Enabling Argon One V5 USB ports..."
        echo "$argon_line" >> "$CONFIG_FILE"
        print_success "Argon One V5 USB ports enabled. A reboot is required."
      fi
    else
      print_warning "Could not find config.txt. Skipping Argon One setup."
    fi
    ;;
  *)
    print_info "Skipping Argon One V5 case setup as requested."
    ;;
esac

# --- Step 8: Configure Autostart
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

# --- Step 9: Finalizing Setup
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
print_warning "A reboot is recommended to apply all changes."
echo