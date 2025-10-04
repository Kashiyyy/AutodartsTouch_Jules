# AutodartsTouch

AutodartsTouch is a kiosk application optimized for touchscreens, primarily designed for use with [Autodarts](https://autodarts.io/) on a Raspberry Pi. It transforms a Raspberry Pi with a touchscreen into a full-featured darts display, providing a user-friendly interface for controlling web content, an integrated on-screen keyboard, and various customization options.

## Tested Platforms

This application has been successfully tested on the following platforms:
-   **Raspberry Pi 5** with Raspberry Pi OS (64-bit)
-   **Linux Mint** (Virtual Machine)
-   **Ubuntu** (Virtual Machine)

## Installation

The installation is designed to be as simple as possible. Just run the following command in your terminal:

```bash
bash <(curl -sL https://raw.githubusercontent.com/Kashiyyy/AutodartsTouch/main/AutodartsTouchInstall.sh)
```

The script will guide you through the following steps:
1.  **System Updates**: Updates your system and installs necessary packages.
2.  **Node.js**: Installs the required Node.js version for the application.
3.  **Autodarts**: Runs the official Autodarts installation script.
4.  **AutodartsTouch**: Downloads the application and installs its dependencies.
5.  **Configuration**: Optionally set up screen rotation and autostart.

After installation, the application will start automatically on every system boot.

## Features

-   **Kiosk Mode**: Starts in full-screen without any window elements for a clean, immersive experience.
-   **Intelligent On-Screen Keyboard**: A customizable keyboard that automatically appears when you tap an input field and hides when you're done.
-   **Update Notifications**: Automatically checks for updates to both AutodartsTouch and the "Tools for Autodarts" extension, displaying a scrolling notification in the toolbar when a new version is available.
-   **Enhanced Touch Experience**: Disables text selection on web pages to prevent accidental highlighting, ensuring smoother navigation on a touchscreen.
-   **Customizable Toolbar**: A sleek bar at the top of the screen with essential controls:
    -   **Tab Navigation**: Switch between up to five configured websites with a single tap.
    -   **Dual-Function Refresh**: A short press refreshes the current page, while a long press performs a "force reload," resetting the tab to its original URL.
    -   **Power Menu**: Access critical system controls to safely **Shutdown**, **Restart**, or **Close** the application.
    -   **Settings Access**: Quickly open the settings panel.
-   **"Tools for Autodarts" Extension Management**: Seamlessly integrates the popular "Tools for Autodarts" browser extension. The app can automatically check for updates, install, and enable or disable the extension directly from the settings menu.
-   **Cursor Control**: Easily toggle the visibility of the mouse cursor from the settings, perfect for pure touchscreen operation.

## Settings

You can access the settings via the gear icon in the toolbar. Here you can fine-tune your experience with the following options:

-   **System Volume**: Adjust the global system volume using a slider.
-   **Toolbar Height**: Set the height of the top toolbar in pixels.
-   **Toolbar Font Size**: Change the font size for the tab names and icons.
-   **On-Screen Keyboard**:
    -   **Layout**: Choose from multiple keyboard layouts (e.g., German, English).
    -   **Width**: Scale the width of the keyboard (in percent).
    -   **Key Height**: Adjust the height of individual keys (in pixels) for easier tapping.
-   **Tab Configuration**: Set up to five tabs with custom names and URLs. Empty fields are ignored.
-   **"Tools for Autodarts" Extension**:
    -   **Enable/Disable**: Toggle the browser extension on or off.
    -   **Manage Version**: View the installed and latest available versions, and update with a single click.
-   **Show Cursor**: Toggle the visibility of the mouse cursor.

Most settings are applied instantly. Changes to tabs, the extension, or certain toolbar styles will trigger a quick and seamless "hot reload" of the interface, avoiding the need for a full application restart.