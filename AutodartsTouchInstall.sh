#!/bin/bash
set -euo pipefail

# ===================================================================================
# AUTODARTS TOUCH INSTALLATION SCRIPT
#
# This script installs and configures the Autodarts Touch application,
# along with its dependencies and system settings.
#
# Website: https://github.com/Kashiyyy/AutodartsTouch
#
# ===================================================================================

# --- Configuration
BRANCH_NAME="${1:-main}"
GITHUB_REPO_URL="https://github.com/Kashiyyy/AutodartsTouch.git"

# --- Environment
GUI_USER="${SUDO_USER:-$(logname)}"
HOME_DIR="$(eval echo "~$GUI_USER")"
APP_DIR="$HOME_DIR/AutodartsTouch"
START_SCRIPT="$APP_DIR/AutodartsTouch.sh"
AUTOSTART_DESKTOP_DIR="$HOME_DIR/.config/autostart"
DESKTOP_FILE="$AUTOSTART_DESKTOP_DIR/AutodartsTouch.desktop"

# --- Global variables
ROTATION_CHOICE=""
ARGON_CHOICE=""
PACKAGE_MANAGER=""
IS_RASPBERRY_PI=false

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

# --- Platform-specific Setup
# Functions for detecting the environment and setting up platform-specific features.

# Detects if the script is running on a Raspberry Pi.
detect_raspberry_pi() {
  if [ -f /proc/device-tree/model ] && grep -q "Raspberry Pi" /proc/device-tree/model; then
    IS_RASPBERRY_PI=true
    print_info "Raspberry Pi detected."
  else
    print_info "Not a Raspberry Pi. Skipping hardware-specific configurations."
  fi
}

# Detects the system's package manager (apt, dnf, yum, pacman).
detect_package_manager() {
  if command -v apt &> /dev/null; then
    PACKAGE_MANAGER="apt"
  elif command -v dnf &> /dev/null; then
    PACKAGE_MANAGER="dnf"
  elif command -v yum &> /dev/null; then
    PACKAGE_MANAGER="yum"
  elif command -v pacman &> /dev/null; then
    PACKAGE_MANAGER="pacman"
  else
    print_error "Unsupported package manager. Please install dependencies manually."
  fi
  print_info "Detected package manager: $PACKAGE_MANAGER"
}

# A wrapper function to install packages using the detected package manager.
install_packages() {
  local packages=("$@")
  print_info "Installing packages: ${packages[*]}..."
  case "$PACKAGE_MANAGER" in
    apt)
      apt update
      apt install -y "${packages[@]}"
      ;;
    dnf|yum)
      # dnf/yum automatically refreshes metadata, so no separate update command is needed
      dnf install -y "${packages[@]}"
      ;;
    pacman)
      pacman -Sy --noconfirm "${packages[@]}"
      ;;
    *)
      print_error "Package installation not supported for $PACKAGE_MANAGER."
      ;;
  esac
}

# --- Start of Installation
print_header "Starting Autodarts Touch Setup"
detect_package_manager
detect_raspberry_pi
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
if [ "$IS_RASPBERRY_PI" = true ]; then
  configure_rotation
  configure_argon_one
fi

# --- Step 2: System Update and Package Installation
print_header "Step 2: Installing System Dependencies"
# Translating package names for different distributions
declare -a packages
case "$PACKAGE_MANAGER" in
  apt)
    packages=("curl" "git" "build-essential" "alsa-utils")
    ;;
  dnf|yum)
    # For Fedora/CentOS, 'Development Tools' group is equivalent to build-essential
    packages=("curl" "git" "@development-tools" "alsa-utils")
    ;;
  pacman)
    # For Arch, base-devel group is equivalent to build-essential
    packages=("curl" "git" "base-devel" "alsa-utils")
    ;;
  *)
    print_error "Package name translation not configured for $PACKAGE_MANAGER."
    ;;
esac

install_packages "${packages[@]}" || print_warning "Could not install all packages, but continuing."

# --- Step 3: Node.js Installation
print_header "Step 3: Installing Node.js"

# Installs Node.js using a universal method that is not dependent on a specific
# package manager. It downloads the official binaries, extracts them, and creates
# symbolic links in /usr/local/bin.
NODE_VERSION="20.12.2" # Specify a recent LTS version
ARCH=$(uname -m)
NODE_ARCH=""

# Map architecture names
case $ARCH in
  x86_64) NODE_ARCH="x64" ;;
  aarch64) NODE_ARCH="arm64" ;;
  armv7l) NODE_ARCH="armv7l" ;;
  *) print_error "Unsupported architecture: $ARCH" ;;
esac

NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
INSTALL_DIR="/usr/local/lib/nodejs"

if command -v node >/dev/null && [[ "$(node -v)" == "v${NODE_VERSION}" ]]; then
  print_info "Node.js v${NODE_VERSION} is already installed."
else
  print_info "Installing Node.js v${NODE_VERSION} for ${ARCH}..."

  # Clean up previous installations
  rm -rf "$INSTALL_DIR"
  rm -f /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx

  # Download and extract
  curl -fsSL "$NODE_URL" -o /tmp/node.tar.xz
  mkdir -p "$INSTALL_DIR"
  tar -xJf /tmp/node.tar.xz -C "$INSTALL_DIR" --strip-components=1
  rm /tmp/node.tar.xz

  # Create symlinks
  ln -s "$INSTALL_DIR/bin/node" /usr/local/bin/node
  ln -s "$INSTALL_DIR/bin/npm" /usr/local/bin/npm
  ln -s "$INSTALL_DIR/bin/npx" /usr/local/bin/npx

  # Verify installation
  if ! command -v node >/dev/null; then
    print_error "Node.js installation failed. Please install it manually."
  fi
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
# Clean up old directory
rm -rf "$APP_DIR"

print_info "Cloning repository to a temporary directory..."
TMP_DIR=$(mktemp -d)
# The repo name is derived from the URL, e.g., "AutodartsTouch_Jules"
REPO_NAME=$(basename "$GITHUB_REPO_URL" .git)
CLONE_DIR="$TMP_DIR/$REPO_NAME"

if ! git clone --depth 1 --branch "$BRANCH_NAME" "$GITHUB_REPO_URL" "$CLONE_DIR"; then
  print_error "Failed to clone the repository. Please check the URL and your connection."
fi

# The application files are in the 'AutodartsTouch' subdirectory.
SOURCE_SUBDIR="$CLONE_DIR/AutodartsTouch"

# Check if the source subdirectory exists
if [ ! -d "$SOURCE_SUBDIR" ]; then
    print_error "The 'AutodartsTouch' subdirectory was not found in the repository."
fi

# Move the entire application subdirectory to the final destination
print_info "Moving application files to $APP_DIR..."
if ! mv "$SOURCE_SUBDIR" "$APP_DIR"; then
    print_error "Failed to move application files."
fi

# Clean up the temporary directory
rm -rf "$TMP_DIR"

# Set ownership and permissions now that all files are in place
chown -R "$GUI_USER:$GUI_USER" "$APP_DIR"
chmod +x "$START_SCRIPT"
print_success "Application files downloaded successfully to $APP_DIR."


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

if [ "$IS_RASPBERRY_PI" = true ]; then
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
else
  print_info "Skipping all hardware-specific configurations."
fi

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