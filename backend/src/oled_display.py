import asyncio
from settings import load_settings, get_default_settings
from oled_renderer import render_oled_page


async def async_display_oled():
    """Asynchronous OLED update loop using configurable pages from settings."""
    settings = load_settings()
    oled = None
    
    if settings.get("dev_mode", False):
        print("🖥️ OLED: dev_mode ON, display loop running (no hardware).")
    else:
        # Lazy init: only import and init hardware when dev_mode is False (e.g. on Pi)
        try:
            import board
            import busio
            import adafruit_ssd1306
            i2c = busio.I2C(board.SCL, board.SDA)
            oled = adafruit_ssd1306.SSD1306_I2C(128, 64, i2c)
        except Exception as e:
            print(f"⚠ OLED hardware init failed: {e}")
            oled = None

    current_page_index = 0
    
    # Initial render to set display state immediately
    print("🖥️ OLED: Performing initial render...")
    settings = load_settings()
    oled_config = settings.get("oled_config", {})
    pages = oled_config.get("pages", [])
    enabled_pages = [p for p in pages if p.get("enabled", True)]
    
    if not enabled_pages:
        print("⚠️ OLED: No enabled pages found in config, using defaults from get_default_settings()")
        # Use defaults from get_default_settings()
        default_settings = get_default_settings()
        default_oled_config = default_settings.get("oled_config", {})
        default_pages = default_oled_config.get("pages", [])
        enabled_pages = [p for p in default_pages if p.get("enabled", True)]
        
        if enabled_pages:
            print(f"🖥️ OLED: Using {len(enabled_pages)} default pages")
            await render_oled_page(enabled_pages[0], settings, oled)
        else:
            print("❌ OLED: No default pages available!")
    else:
        print(f"🖥️ OLED: Rendering initial page: {enabled_pages[0].get('id', 'unknown')}")
        await render_oled_page(enabled_pages[0], settings, oled)

    while True:
        settings = load_settings()
        oled_config = settings.get("oled_config", {})
        pages = oled_config.get("pages", [])
        
        # Filter to enabled pages only
        enabled_pages = [p for p in pages if p.get("enabled", True)]
        
        if not enabled_pages:
            # Fallback to defaults if no pages found
            default_settings = get_default_settings()
            default_oled_config = default_settings.get("oled_config", {})
            default_pages = default_oled_config.get("pages", [])
            enabled_pages = [p for p in default_pages if p.get("enabled", True)]
            
            if not enabled_pages:
                await asyncio.sleep(10)
                continue
        
        # Wrap index
        if current_page_index >= len(enabled_pages):
            current_page_index = 0
        
        page_config = enabled_pages[current_page_index]
        
        # Render page (to hardware if available, always update state for mirroring)
        await render_oled_page(page_config, settings, oled)
        
        # Use global interval setting for all pages
        interval = settings.get("oled_page_interval_seconds", 10)
        interval = max(1, min(300, int(interval)))
        await asyncio.sleep(interval)
        
        current_page_index = (current_page_index + 1) % len(enabled_pages)


async def start_oled_loop():
    """Starts OLED display loop asynchronously without blocking other tasks."""
    asyncio.create_task(async_display_oled())


if __name__ == "__main__":
    asyncio.run(async_display_oled())
