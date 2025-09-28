# AutodartsTouch

AutodartsTouch is a kiosk application optimized for touchscreens, primarily designed for use with [Autodarts](https://autodarts.io/) on a Raspberry Pi. It provides a user-friendly interface for controlling web content, an integrated on-screen keyboard, and various customization options.

## What is AutodartsTouch?

AutodartsTouch transforms a Raspberry Pi with a touchscreen into a full-featured darts display. The application starts in full-screen mode (kiosk mode) and, by default, displays the Autodarts website. Thanks to the customizable tab function, any other websites, such as a local service page, can also be integrated.

The integrated toolbar allows for easy switching between tabs, reloading the current page, and accessing settings. An on-screen keyboard automatically appears when an input field is tapped, allowing operation without a physical keyboard.

## Installation

The installation has been made as simple as possible. Just run the following command in your Raspberry Pi terminal:

```bash
bash <(curl -sL https://raw.githubusercontent.com/Kashiyyy/AutodartsTouch_Jules/main/AutodartsTouchInstall.sh)
```

The script will guide you through the following steps:
1.  **System Updates**: Updates your system and installs necessary packages.
2.  **Node.js**: Installs the required Node.js version for the application.
3.  **Autodarts**: Runs the official Autodarts installation script.
4.  **AutodartsTouch**: Downloads the application and installs its dependencies.
5.  **Configuration**: Optionally set up screen rotation and autostart.

After installation, the application will start automatically on every system boot.

## Features

-   **Kiosk Mode**: Starts in full-screen without any visible window elements for a clean look.
-   **Toolbar**: A bar fixed at the top of the screen with the main controls:
    -   **Keyboard Button**: To manually show or hide the on-screen keyboard.
    -   **Tabs**: To switch between the configured websites.
    -   **Refresh Button**: Reloads the currently displayed page.
    -   **Settings Button**: Opens the settings page.
-   **On-screen Keyboard**: A customizable keyboard that appears automatically when needed.
-   **Tabbed Browsing**: Configure up to five different websites that you can easily switch between.

## Settings

You can access the settings via the gear icon in the toolbar. Here you can adjust the following options:

-   **System Volume**: Adjust the global system volume using a slider.
-   **Keyboard Width**: Scale the width of the on-screen keyboard (in percent).
-   **Key Height**: Adjust the height of the individual keys (in pixels) to make them easier to use.
-   **Tab Settings**: Configure up to five tabs with their own name and URL. Empty fields will be ignored in the toolbar.

Changes to the tabs require a restart of the application to take effect. All other settings are applied immediately.