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

# Tries to find an existing installation by reading the autostart .desktop file.
# This ensures that updates are applied to the correct directory.
discover_app_dir() {
  local desktop_file="$1"
  if [ -f "$desktop_file" ]; then
    print_info "Found existing .desktop file, reading installation path..." >&2
    # Extract the path from 'Exec=bash /path/to/AutodartsTouch.sh'
    # sed: find the Exec line, remove the prefix, remove the script suffix, print.
    # tr: remove potential carriage returns.
    local exec_path
    exec_path=$(grep '^Exec=' "$desktop_file" | sed -n 's/^Exec=bash //; s|/AutodartsTouch\.sh$||p' | tr -d '\r')

    if [ -n "$exec_path" ] && [ -d "$exec_path" ]; then
      # Return the discovered path by printing it
      echo "$exec_path"
      return 0
    fi
  fi
  # Return nothing if not found
  return 1
}


# --- Configuration
# If a branch name is provided as an argument, use it.
# Otherwise, fetch the tag name of the latest release from GitHub.
if [ -n "${1-}" ]; then
  BRANCH_NAME="$1"
  print_info "A specific branch '$BRANCH_NAME' was requested."
else
  print_info "No specific branch requested. Finding the latest release from GitHub..."
  # Use curl to get the latest release, grep for the tag_name line, and cut to extract the value.
  LATEST_TAG=$(curl -s https://api.github.com/repos/Kashiyyy/AutodartsTouch/releases/latest | grep '"tag_name":' | cut -d '"' -f 4)

  if [ -z "$LATEST_TAG" ]; then
    print_warning "Could not fetch the latest release tag. Defaulting to 'main' branch."
    BRANCH_NAME="main"
  else
    BRANCH_NAME="$LATEST_TAG"
    print_success "Latest release found: $BRANCH_NAME"
  fi
fi

# --- Safeguard against running outdated branches
# This prevents a user from accidentally running an old update script that lacks critical fixes.
OUTDATED_BRANCHES=("preserve-extension-on-update" "fix/preserve-extension-on-update-robust")
for old_branch in "${OUTDATED_BRANCHES[@]}"; do
  if [ "$BRANCH_NAME" == "$old_branch" ]; then
    print_error "This installation script is from an outdated branch ('$BRANCH_NAME').
    To ensure a successful update and prevent data loss, please run the update
    using the latest branch name: 'fix/preserve-extension-final'
    Or, for the latest stable release, run the installer with no arguments."
  fi
done

GITHUB_REPO_URL="https://github.com/Kashiyyy/AutodartsTouch.git"

# --- Environment
GUI_USER="${SUDO_USER:-$(logname)}"
HOME_DIR="$(eval echo "~$GUI_USER")"
DEFAULT_APP_DIR="$HOME_DIR/AutodartsTouch" # Default for new installs
AUTOSTART_DESKTOP_DIR="$HOME_DIR/.config/autostart"
DESKTOP_FILE="$AUTOSTART_DESKTOP_DIR/AutodartsTouch.desktop"

# Discover the application directory. If found, use it. Otherwise, use the default.
APP_DIR=$(discover_app_dir "$DESKTOP_FILE")
if [ -z "$APP_DIR" ]; then
    print_info "No existing installation found. Using default path: $DEFAULT_APP_DIR"
    APP_DIR="$DEFAULT_APP_DIR"
else
    print_success "Found existing installation at: $APP_DIR"
fi

START_SCRIPT="$APP_DIR/AutodartsTouch.sh"
VERSION_FILE="$APP_DIR/version.json"

# --- Global variables
ROTATION_CHOICE=""
ARGON_CHOICE=""
PACKAGE_MANAGER=""
IS_RASPBERRY_PI=false

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
print_info "Installing from branch/tag: $BRANCH_NAME"

# --- Step 1: System Update and Package Installation

# --- Step 2: System Update and Package Installation
print_header "Step 2: Installing System Dependencies"
# Translating package names for different distributions
declare -a packages
case "$PACKAGE_MANAGER" in
  apt)
    packages=("curl" "git" "unzip" "build-essential" "alsa-utils")
    ;;
  dnf|yum)
    # For Fedora/CentOS, 'Development Tools' group is equivalent to build-essential
    packages=("curl" "git" "unzip" "@development-tools" "alsa-utils")
    ;;
  pacman)
    # For Arch, base-devel group is equivalent to build-essential
    packages=("curl" "git" "unzip" "base-devel" "alsa-utils")
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

# --- Backup existing extension directory if it exists
EXTENSION_DIR="$APP_DIR/extension"
BACKUP_DIR="/tmp/AutodartsTouch_Extension_Backup"
if [ -d "$EXTENSION_DIR" ]; then
    print_info "Backing up existing extension directory..."
    rm -rf "$BACKUP_DIR" # Remove old backup if it exists
    mv "$EXTENSION_DIR" "$BACKUP_DIR"
    print_success "Extension directory backed up to $BACKUP_DIR"
fi

cd /tmp
rm -rf "$APP_DIR"

# If a branch name was provided as an argument, clone that specific branch.
if [ -n "${1-}" ]; then
    print_info "Cloning branch '$BRANCH_NAME' from repository..."
    TMP_DIR=$(mktemp -d)
    REPO_NAME=$(basename "$GITHUB_REPO_URL" .git)
    CLONE_DIR="$TMP_DIR/$REPO_NAME"

    if ! git clone --depth 1 --branch "$BRANCH_NAME" "$GITHUB_REPO_URL" "$CLONE_DIR"; then
        print_error "Failed to clone the repository."
    fi

    SOURCE_SUBDIR="$CLONE_DIR/AutodartsTouch"
    if [ ! -d "$SOURCE_SUBDIR" ]; then
        print_error "The 'AutodartsTouch' subdirectory was not found in the repository."
    fi

    print_info "Moving application files to $APP_DIR..."
    mv "$SOURCE_SUBDIR" "$APP_DIR"
    rm -rf "$TMP_DIR"

# If no branch name was provided, download the latest release as a zip file.
else
    print_info "Downloading latest release source code..."
    ZIP_URL=$(curl -s https://api.github.com/repos/Kashiyyy/AutodartsTouch/releases/latest | grep '"zipball_url":' | cut -d '"' -f 4)
    if [ -z "$ZIP_URL" ]; then
        print_error "Could not determine the download URL for the latest release."
    fi

    TEMP_ZIP="/tmp/source.zip"
    if ! curl -L "$ZIP_URL" -o "$TEMP_ZIP"; then
        print_error "Failed to download the latest release zip file."
    fi

    TMP_DIR=$(mktemp -d)
    unzip "$TEMP_ZIP" -d "$TMP_DIR"
    rm "$TEMP_ZIP"

    EXTRACTED_DIR=$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d)
    if [ ! -d "$EXTRACTED_DIR" ]; then
        print_error "Could not find the extracted folder."
    fi

    SOURCE_SUBDIR="$EXTRACTED_DIR/AutodartsTouch"
    if [ ! -d "$SOURCE_SUBDIR" ]; then
        print_error "The 'AutodartsTouch' subdirectory was not found in the extracted files."
    fi

    print_info "Moving application files to $APP_DIR..."
    mv "$SOURCE_SUBDIR" "$APP_DIR"
    rm -rf "$TMP_DIR"
fi

# Set ownership and permissions now that all files are in place
chown -R "$GUI_USER:$GUI_USER" "$APP_DIR"
chmod +x "$START_SCRIPT"
print_success "Application files downloaded successfully to $APP_DIR."

# --- Restore extension directory if a backup exists
if [ -d "$BACKUP_DIR" ]; then
    print_info "Restoring extension directory..."
    mv "$BACKUP_DIR" "$EXTENSION_DIR"
    print_success "Extension directory restored."
fi


# --- Step 6: Install Node.js Dependencies
print_header "Step 6: Installing Application Dependencies"
print_info "Running 'npm install'. This might take a moment..."
if sudo -u "$GUI_USER" bash -c "cd '$APP_DIR' && npm install --omit=dev"; then
  print_success "Application dependencies installed."
else
  print_error "Failed to install npm dependencies. Please check the logs."
fi

# --- Step 7: Storing Version Information
print_header "Step 7: Storing Version Information"
print_info "Creating version file at $VERSION_FILE..."
cat > "$VERSION_FILE" <<EOL
{
  "version": "$BRANCH_NAME"
}
EOL
print_success "Version information saved."

# --- Step 8: Apply System Configurations
print_header "Step 8: Applying System Configurations"

# Hardware-specific configurations for Raspberry Pi (rotation, Argon case) have been removed.
# The user can configure these manually if needed.

# --- Step 9: Configure Autostart
print_header "Step 9: Setting up Autostart"
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

# --- Step 10: Finalizing Setup
print_header "Step 10: Finalizing Permissions"
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