import time
from playwright.sync_api import sync_playwright, expect

def verify_toolbar():
    with sync_playwright() as p:
        try:
            # Connect to the running Electron app
            browser = p.chromium.connect_over_cdp("http://localhost:9222")
            context = browser.contexts[0]

            # Wait for a moment to ensure all views are loaded
            time.sleep(5)

            # Find the toolbar page
            toolbar_page = None
            for page in context.pages():
                if "index.html" in page.url:
                    toolbar_page = page
                    break

            if not toolbar_page:
                print("Error: Toolbar page (index.html) not found.")
                browser.close()
                return

            # Expect the toolbar to be visible and have the correct aria-label
            toolbar_element = toolbar_page.locator('#toolbar')
            expect(toolbar_element).to_be_visible()
            expect(toolbar_element).to_have_attribute('aria-label', 'AutodartsTouch Controls')

            # Take a screenshot of the entire window (the first page is usually the main window)
            main_page = context.pages()[0]
            main_page.screenshot(path="jules-scratch/verification/verification.png")
            print("Screenshot taken successfully.")

        except Exception as e:
            print(f"An error occurred: {e}")
        finally:
            if 'browser' in locals() and browser.is_connected():
                browser.close()

if __name__ == "__main__":
    verify_toolbar()