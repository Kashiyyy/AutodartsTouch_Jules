from playwright.sync_api import sync_playwright, expect
import time

def run_verification():
    with sync_playwright() as p:
        # Connect to the running Electron application
        browser = p.chromium.connect_over_cdp("http://localhost:9222")
        context = browser.contexts[0]

        # There might be multiple pages, we need to find the right ones.
        # Let's wait a bit to ensure all pages have a chance to load.
        time.sleep(2)
        pages = context.pages()

        toolbar_page = None
        for page in pages:
            # The toolbar is in index.html
            if "index.html" in page.url:
                toolbar_page = page
                break

        if not toolbar_page:
             raise Exception("Could not find the toolbar page (index.html)")

        # The settings page might already be open.
        settings_page = None
        for page in pages:
             if "settings.html" in page.url:
                settings_page = page
                break

        if not settings_page:
            # If not open, click the settings button in the toolbar to open it.
            # The button is the 5th one in the toolbar. A more robust selector would be better,
            # but for this verification, we'll use what we know.
            settings_button = toolbar_page.locator('button[aria-label="Settings"]')
            if not settings_button.is_visible():
                 # Fallback to the less stable selector if the aria-label is not present
                 settings_button = toolbar_page.locator('body > div > div.col-auto.d-flex > button:nth-child(5)')

            settings_button.click()
            time.sleep(2) # Wait for settings view to load

            # Re-check for the settings page
            for page in context.pages():
                if "settings.html" in page.url:
                    settings_page = page
                    break

        if not settings_page:
            raise Exception("Could not find the settings page (settings.html) after trying to open it.")

        settings_page.bring_to_front()

        # Give the page time to load and fetch version info from the API
        expect(settings_page.locator("#app-version-latest")).not_to_have_text("Loading...", timeout=10000)
        expect(settings_page.locator("#extension-version-latest")).not_to_have_text("Loading...", timeout=10000)

        # Take a screenshot
        settings_page.screenshot(path="jules-scratch/verification/verification.png")

if __name__ == "__main__":
    run_verification()