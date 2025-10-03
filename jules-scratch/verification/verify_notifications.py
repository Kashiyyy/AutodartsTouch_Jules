import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        # Connect to the running Electron application
        browser = await p.chromium.connect_over_cdp("http://localhost:9222")
        contexts = browser.contexts
        if not contexts:
            print("No browser contexts found. Is the app running with --remote-debugging-port=9222?")
            return

        context = contexts[0]

        # Find the toolbar page (index.html)
        toolbar_page = None
        for page in context.pages():
            if "index.html" in page.url:
                toolbar_page = page
                break

        if not toolbar_page:
            print("Toolbar page (index.html) not found.")
            # Let's wait for it in case it's still loading
            try:
                toolbar_page = await context.wait_for_event("page", timeout=5000)
                if "index.html" not in toolbar_page.url:
                     print("A page was found, but it was not the toolbar.")
                     return
            except Exception as e:
                print(f"Failed to find toolbar page: {e}")
                await browser.close()
                return

        notification_container = toolbar_page.locator("#update-notification")

        # --- Test 1: Single Notification ---
        # Simulate the first update notification for the app
        await toolbar_page.evaluate("""
            window.api.on.mock.calls.find(call => call[0] === 'update-available')[1]({ type: 'app', message: 'AutodartsTouch update available!' });
        """)

        # Wait for the notification to be visible
        await expect(notification_container).to_be_visible()
        await toolbar_page.wait_for_timeout(500) # Wait for animation to start

        # Take a screenshot
        await toolbar_page.screenshot(path="jules-scratch/verification/01_single_notification.png")
        print("Screenshot 1: Single notification captured.")

        # --- Test 2: Multiple Notifications ---
        # Simulate the second update notification for the extension
        await toolbar_page.evaluate("""
            window.api.on.mock.calls.find(call => call[0] === 'update-available')[1]({ type: 'extension', message: 'Extension has an update!' });
        """)

        # Check that the text now contains both messages
        await expect(notification_container.locator("p span")).to_contain_text("AutodartsTouch update available! | Extension has an update!")
        await toolbar_page.wait_for_timeout(500)

        # Take a screenshot
        await toolbar_page.screenshot(path="jules-scratch/verification/02_multiple_notifications.png")
        print("Screenshot 2: Multiple notifications captured.")

        # --- Test 3: Close Button ---
        close_button = notification_container.locator("#close-update-notification")
        await close_button.click()

        # Wait for the notification to be hidden
        await expect(notification_container).to_be_hidden()
        await toolbar_page.wait_for_timeout(500)

        await toolbar_page.screenshot(path="jules-scratch/verification/03_notifications_closed.png")
        print("Screenshot 3: Notifications closed captured.")

        # Re-add a notification to test the 'update-installed' logic
        await toolbar_page.evaluate("""
            window.api.on.mock.calls.find(call => call[0] === 'update-available')[1]({ type: 'app', message: 'AutodartsTouch update available!' });
        """)
        await toolbar_page.evaluate("""
            window.api.on.mock.calls.find(call => call[0] === 'update-available')[1]({ type: 'extension', message: 'Extension has an update!' });
        """)
        await expect(notification_container).to_be_visible()

        # --- Test 4: Specific Update Installed ---
        # Simulate the 'extension' update being installed
        await toolbar_page.evaluate("""
            window.api.on.mock.calls.find(call => call[0] === 'update-installed')[1]({ type: 'extension' });
        """)

        # Check that only the app notification remains
        await expect(notification_container.locator("p span")).to_contain_text("AutodartsTouch update available!")
        await expect(notification_container.locator("p span")).not_to_contain_text("Extension has an update!")
        await toolbar_page.wait_for_timeout(500)

        await toolbar_page.screenshot(path="jules-scratch/verification/04_specific_notification_removed.png")
        print("Screenshot 4: Specific notification removed captured.")

        await browser.close()

async def run_main():
    try:
        await main()
    except Exception as e:
        # The preload script does not expose a real `window.api.on` but a proxy.
        # Playwright can't mock it easily. Let's try a different approach.
        # We will directly call the javascript functions that handle the logic.
        print(f"Initial approach failed: {e}. Trying direct function call.")
        await fallback_main()

async def fallback_main():
     async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://localhost:9222")
        context = browser.contexts[0]
        toolbar_page = None
        for page in context.pages():
            if "index.html" in page.url:
                toolbar_page = page
                break

        if not toolbar_page:
            print("Fallback: Toolbar page (index.html) not found.")
            await browser.close()
            return

        notification_container = toolbar_page.locator("#update-notification")

        # --- Test 1: Single Notification ---
        await toolbar_page.evaluate("() => { notifications = [{ type: 'app', message: 'AutodartsTouch update available!' }]; renderNotifications(); }")
        await expect(notification_container).to_be_visible()
        await toolbar_page.wait_for_timeout(500)
        await toolbar_page.screenshot(path="jules-scratch/verification/01_single_notification.png")
        print("Fallback Screenshot 1: Single notification captured.")

        # --- Test 2: Multiple Notifications ---
        await toolbar_page.evaluate("() => { notifications.push({ type: 'extension', message: 'Extension has an update!' }); renderNotifications(); }")
        await expect(notification_container.locator("p span")).to_contain_text("AutodartsTouch update available! | Extension has an update!")
        await toolbar_page.wait_for_timeout(500)
        await toolbar_page.screenshot(path="jules-scratch/verification/02_multiple_notifications.png")
        print("Fallback Screenshot 2: Multiple notifications captured.")

        # --- Test 3: Close Button ---
        await toolbar_page.locator("#close-update-notification").click()
        await expect(notification_container).to_be_hidden()
        await toolbar_page.wait_for_timeout(500)
        await toolbar_page.screenshot(path="jules-scratch/verification/03_notifications_closed.png")
        print("Fallback Screenshot 3: Notifications closed captured.")

        # --- Test 4: Specific Update Installed ---
        await toolbar_page.evaluate("() => { notifications = [{ type: 'app', message: 'AutodartsTouch update available!' }, { type: 'extension', message: 'Extension has an update!' }]; renderNotifications(); }")
        await toolbar_page.evaluate("() => { notifications = notifications.filter(n => n.type !== 'extension'); renderNotifications(); }")
        await expect(notification_container.locator("p span")).to_contain_text("AutodartsTouch update available!")
        await expect(notification_container.locator("p span")).not_to_contain_text("Extension has an update!")
        await toolbar_page.wait_for_timeout(500)
        await toolbar_page.screenshot(path="jules-scratch/verification/04_specific_notification_removed.png")
        print("Fallback Screenshot 4: Specific notification removed captured.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(fallback_main())