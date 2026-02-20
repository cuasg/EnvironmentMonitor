"""
OLED page renderer using configurable pages from settings.
Also exposes current display state for frontend mirroring.
"""
import asyncio
from datetime import datetime
from settings import load_settings

# Global state for current display (for mirroring)
_current_display_state = {
    "page_id": None,
    "page_title": "",
    "lines": [],
    "pixel_data": None,  # Base64 encoded 128x64 monochrome image
}

def format_time(timestamp):
    """Convert timestamp from JSON to 12-hour format for OLED display."""
    if not timestamp or timestamp == "N/A":
        return "N/A"
    formats = ["%Y-%m-%d %I:%M %p", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"]
    for fmt in formats:
        try:
            dt = datetime.strptime(timestamp, fmt)
            return dt.strftime("%I:%M %p")
        except ValueError:
            continue
    return "N/A"


def format_value(value, default="N/A"):
    """Format a value for display."""
    if value is None or value == "N/A":
        return default
    if isinstance(value, (int, float)):
        return str(value)
    return str(value)


def render_page_content(page_config, settings):
    """Render a page's content lines based on config and current settings."""
    lines = []
    
    # Title line (always first, font_size 14)
    if page_config.get("title"):
        lines.append({"text": page_config["title"], "font_size": 14, "color": "white"})
    
    # Render elements
    for element in page_config.get("elements", []):
        if element.get("type") != "text":
            continue
        
        content = element.get("content", "")
        # Replace placeholders with actual values
        content = content.replace("{pH_monitoring_enabled}", 
            "ON" if settings.get("pH_monitoring_enabled") else "OFF")
        content = content.replace("{low_pH}", 
            format_value(settings.get("pump_settings", {}).get("low_pH")))
        content = content.replace("{high_pH}", 
            format_value(settings.get("pump_settings", {}).get("high_pH")))
        content = content.replace("{pH_value}", 
            format_value(settings.get("pH_value")))
        content = content.replace("{ppm_500}", 
            format_value(settings.get("ppm_500")))
        content = content.replace("{humidity}", 
            format_value(settings.get("humidity")))
        content = content.replace("{air_temperature_f}", 
            format_value(settings.get("air_temperature_f")))
        content = content.replace("{water_temperature_f}", 
            format_value(settings.get("water_temperature_f")))
        content = content.replace("{last_pump_activated}", 
            format_value(settings.get("last_pump_activation", {}).get("pump", "None")))
        content = content.replace("{last_pump_time}", 
            format_time(settings.get("last_pump_activation", {}).get("timestamp", "N/A")))
        content = content.replace("{last_ph_check}", 
            format_time(settings.get("last_ph_check", "N/A")))
        content = content.replace("{next_ph_check}", 
            format_time(settings.get("next_ph_check", "N/A")))
        
        font_size = element.get("font_size", 12)
        color = element.get("color", "white")
        lines.append({"text": content, "font_size": font_size, "color": color})
    
    return lines


def get_current_display_state():
    """Get current OLED display state for frontend mirroring."""
    return _current_display_state.copy()


def set_current_display_state(page_id, page_title, lines, pixel_data=None):
    """Update current display state."""
    global _current_display_state
    _current_display_state = {
        "page_id": page_id,
        "page_title": page_title,
        "lines": lines,
        "pixel_data": pixel_data,
    }


async def render_oled_page(page_config, settings, oled=None):
    """
    Render a page to OLED hardware (if provided) and update display state.
    Returns the rendered lines for mirroring.
    Always generates pixel_data for frontend mirroring, even without hardware.
    """
    lines = render_page_content(page_config, settings)
    pixel_data = None
    
    # Always generate pixel_data for mirroring (works in dev mode without hardware)
    pixel_data = None
    try:
        from PIL import Image, ImageDraw, ImageFont
        import io
        import base64
        
        # Try to load fonts (fallback to default if not available)
        FONT_REGULAR = None
        FONT_LARGE = None
        try:
            FONT_REGULAR = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
            FONT_LARGE = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
            print("✅ OLED: Loaded system fonts")
        except (OSError, IOError, AttributeError):
            # Fallback to default font if system fonts not available (dev mode on Windows)
            try:
                FONT_REGULAR = ImageFont.load_default()
                FONT_LARGE = ImageFont.load_default()
                print("✅ OLED: Using default font")
            except Exception as font_err:
                print(f"⚠ OLED: Could not load fonts: {font_err}")
                FONT_REGULAR = None
                FONT_LARGE = None
        
        if not lines:
            print("⚠ OLED: No lines to render")
        else:
            image = Image.new("1", (128, 64), color=0)  # Black background
            draw = ImageDraw.Draw(image)
            y = 0
            
            for line_data in lines:
                font = FONT_LARGE if line_data.get("font_size", 12) >= 14 else FONT_REGULAR
                text = line_data.get("text", "")
                fill = 255 if line_data.get("color", "white") == "white" else 0
                
                # Center align text
                if font:
                    # Get text bounding box to calculate width
                    bbox = draw.textbbox((0, 0), text, font=font)
                    text_width = bbox[2] - bbox[0]
                    x = (128 - text_width) // 2
                    draw.text((x, y), text, font=font, fill=fill)
                else:
                    # Fallback if no font available - approximate centering
                    text_width = len(text) * 6  # Rough estimate: ~6 pixels per char
                    x = max(0, (128 - text_width) // 2)
                    draw.text((x, y), text, fill=fill)
                
                y += 18 if line_data.get("font_size", 12) >= 14 else 14
                if y >= 64:  # Prevent overflow
                    break
            
            # Convert to base64 for frontend mirroring
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            pixel_data = base64.b64encode(buffer.getvalue()).decode("utf-8")
            print(f"✅ OLED: Generated pixel_data ({len(pixel_data)} chars)")
            
            # If hardware is available, also render to OLED
            if oled:
                try:
                    oled.image(image)
                    oled.show()
                except Exception as e:
                    print(f"⚠ OLED hardware render error: {e}")
                
    except ImportError as e:
        print(f"❌ OLED: PIL/Pillow not installed: {e}")
        print("   Install with: pip install Pillow")
        pixel_data = None
    except Exception as e:
        print(f"⚠ OLED render error: {e}")
        import traceback
        traceback.print_exc()
        pixel_data = None
    
    # Update state for mirroring (always, even without hardware)
    # Ensure we always have at least the title and lines
    text_lines = [l.get("text", "") for l in lines] if lines else []
    set_current_display_state(
        page_config.get("id"),
        page_config.get("title", ""),
        text_lines,
        pixel_data
    )
    
    print(f"🔍 OLED state updated: page_id={page_config.get('id')}, title={page_config.get('title', '')}, lines={len(text_lines)}, has_pixel_data={pixel_data is not None}")
    
    return lines
