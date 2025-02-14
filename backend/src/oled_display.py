import asyncio
import json
import board
import busio
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont
import adafruit_ssd1306

SETTINGS_FILE = "/home/cuasg/plant/backend/src/settings.json"

# ✅ Initialize I2C for OLED
i2c = busio.I2C(board.SCL, board.SDA)

# ✅ Setup OLED Display (128x64)
oled = adafruit_ssd1306.SSD1306_I2C(128, 64, i2c)

# ✅ Load Fonts
FONT_REGULAR = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
FONT_LARGE = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)

def load_settings():
    """Load latest data from settings.json."""
    try:
        with open(SETTINGS_FILE, "r") as file:
            return json.load(file)
    except Exception as e:
        print(f"⚠ Error loading settings: {e}")
        return {}

def format_time(timestamp):
    """Convert timestamp from JSON to 12-hour format for OLED display."""
    if not timestamp or timestamp == "N/A":
        return "N/A"
    
    # ✅ Handle different possible timestamp formats
    formats = ["%Y-%m-%d %I:%M %p", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"]
    
    for fmt in formats:
        try:
            dt = datetime.strptime(timestamp, fmt)
            return dt.strftime("%I:%M %p")  # Convert to 12-hour format
        except ValueError:
            continue  # Try the next format
    
    return "N/A"  # Return "N/A" if all parsing attempts fail

async def async_draw_text(lines):
    """Asynchronously draws multiple lines of text on OLED, ensuring text fits properly."""
    image = Image.new("1", (128, 64))
    draw = ImageDraw.Draw(image)

    y = 0  # Start from top
    if lines:
        draw.text((5, y), lines[0], font=FONT_LARGE, fill=255)  # Header line
        y += 18  # Space for large text

    for line in lines[1:]:
        draw.text((5, y), line, font=FONT_REGULAR, fill=255)
        y += 14  # Adjust spacing for readability

    oled.image(image)
    oled.show()
    await asyncio.sleep(0)  # ✅ Allow async scheduling

async def async_display_oled():
    """Asynchronous OLED update loop that cycles through pages every 10 seconds."""
    pages = [
        "system_status",
        "sensor_data",
        "pump_status",
        "ph_check_times"
    ]
    current_page = 0

    while True:
        settings = load_settings()

        # ✅ Page 1: System Status
        if pages[current_page] == "system_status":
            ph_monitoring = "ON" if settings.get("pH_monitoring_enabled") else "OFF"
            low_pH = settings.get("pump_settings", {}).get("low_pH", "N/A")
            high_pH = settings.get("pump_settings", {}).get("high_pH", "N/A")

            lines = [
                "SYSTEM STATUS",
                f"pH Mon: {ph_monitoring}",
                f"Range: {low_pH}-{high_pH}"
            ]

        # ✅ Page 2: Sensor Data
        elif pages[current_page] == "sensor_data":
            ph_value = settings.get("pH_value", "N/A")
            ppm_500 = settings.get("ppm_500", "N/A")
            humidity = settings.get("humidity", "N/A")
            air_temp = settings.get("air_temperature_f", "N/A")
            water_temp = settings.get("water_temperature_f", "N/A")

            lines = [
                "SENSORS",
                f"pH: {ph_value}  PPM: {ppm_500}",
                f"Hum: {humidity}%  Air: {air_temp}F",
                f"Water: {water_temp}F"
            ]

        # ✅ Page 3: Pump Status
        elif pages[current_page] == "pump_status":
            last_pump = settings.get("last_pump_activation", {}).get("pump", "None")
            last_pump_time = format_time(settings.get("last_pump_activation", {}).get("timestamp", "N/A"))

            lines = [
                "PUMP STATUS",
                f"Last: {last_pump}",
                f"Time: {last_pump_time}"
            ]

        # ✅ Page 4: pH Check Times
        elif pages[current_page] == "ph_check_times":
            last_ph_check = format_time(settings.get("last_ph_check", "N/A"))
            next_ph_check = format_time(settings.get("next_ph_check", "N/A"))

            lines = [
                "pH CHECK TIMES",
                f"Last: {last_ph_check}",
                f"Next: {next_ph_check}"
            ]

        # ✅ Display formatted text asynchronously
        await async_draw_text(lines)

        # ✅ Wait before switching pages (OLED updates every 10 seconds)
        await asyncio.sleep(10)  
        current_page = (current_page + 1) % len(pages)

async def start_oled_loop():
    """Starts OLED display loop asynchronously without blocking other tasks."""
    asyncio.create_task(async_display_oled())  # ✅ Ensures OLED updates every 10s

if __name__ == "__main__":
    asyncio.run(async_display_oled())  # ✅ Start OLED updates asynchronously
