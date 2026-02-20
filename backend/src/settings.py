import json
import os
import asyncio
from datetime import datetime

# Use env if set; otherwise same directory as this file (works on Pi and WSL)
_SETTINGS_DIR = os.environ.get(
    "PLANT_SETTINGS_DIR",
    os.path.dirname(os.path.abspath(__file__)),
)
SETTINGS_FILE = os.path.join(_SETTINGS_DIR, "settings.json")
BACKUP_FILE = os.path.join(_SETTINGS_DIR, "settings_backup.json")

# ✅ Ensure timestamps are stored as strings in settings.json
def ensure_datetime(value):
    if isinstance(value, str):
        try:
            return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None
    return value if isinstance(value, datetime) else None



# ✅ Load Settings (No Async)
def load_settings():
    """Load settings from the JSON file, ensuring proper formatting."""
    if not os.path.exists(SETTINGS_FILE):
        print("⚠ Settings file missing! Creating default settings.")
        settings = get_default_settings()
        with open(SETTINGS_FILE, "w") as file:
            json.dump(settings, file, indent=4)  # ✅ Ensure file is created!
        return settings

    try:
        with open(SETTINGS_FILE, "r") as file:
            settings = json.load(file)

        if not isinstance(settings, dict):
            raise ValueError("⚠ Invalid settings format. Expected dictionary.")

        # ✅ Preserve timestamps **as strings** if parsing fails
        last_ph_check = settings.get("last_ph_check", "N/A")
        next_ph_check = settings.get("next_ph_check", "N/A")

        parsed_last_ph_check = ensure_datetime(last_ph_check)
        parsed_next_ph_check = ensure_datetime(next_ph_check)

        settings["last_ph_check"] = last_ph_check if parsed_last_ph_check is None else parsed_last_ph_check.strftime("%Y-%m-%d %I:%M %p")
        settings["next_ph_check"] = next_ph_check if parsed_next_ph_check is None else parsed_next_ph_check.strftime("%Y-%m-%d %I:%M %p")

        # ✅ Ensure last_pump_activation exists and preserve timestamp
        if "last_pump_activation" not in settings or not isinstance(settings["last_pump_activation"], dict):
            settings["last_pump_activation"] = {"pump": None, "timestamp": "N/A"}
        else:
            last_pump_timestamp = settings["last_pump_activation"].get("timestamp", "N/A")
            parsed_pump_timestamp = ensure_datetime(last_pump_timestamp)
            settings["last_pump_activation"]["timestamp"] = last_pump_timestamp if parsed_pump_timestamp is None else parsed_pump_timestamp.strftime("%Y-%m-%d %I:%M %p")

        # ✅ Ensure oled_config exists with default pages if missing
        if "oled_config" not in settings or not isinstance(settings["oled_config"], dict) or not settings["oled_config"].get("pages"):
            print("⚠️ OLED config missing or empty, merging defaults...")
            default_settings = get_default_settings()
            settings["oled_config"] = default_settings.get("oled_config", {})

        return settings

    except json.JSONDecodeError:
        print("❌ Error: Corrupt settings.json detected. Creating backup and resetting.")
        os.rename(SETTINGS_FILE, BACKUP_FILE)
        settings = get_default_settings()
        with open(SETTINGS_FILE, "w") as file:
            json.dump(settings, file, indent=4)
        return settings  

    except Exception as e:
        print(f"❌ Unexpected error loading settings: {e}")
        return get_default_settings()



# ✅ Save Settings (Proper Async Handling)
async def save_settings(updated_settings):
    """Save settings without overwriting non-changing values."""
    try:
        print(f"\n🔍 DEBUG: [save_settings] Called with updated settings = {updated_settings}")

        if not isinstance(updated_settings, dict):
            print(f"❌ ERROR: Expected dictionary, got {type(updated_settings)} - Converting to empty dictionary.")
            updated_settings = {}

        # ✅ Load current settings FIRST
        current_settings = load_settings()

        # ✅ Preserve existing timestamps & last pump activation before merging
        preserved_last_ph_check = current_settings.get("last_ph_check", "N/A")
        preserved_next_ph_check = current_settings.get("next_ph_check", "N/A")
        preserved_last_pump_activation = current_settings.get("last_pump_activation", {"pump": None, "timestamp": "N/A"})

        # ✅ Debug: Print before merging
        print(f"🔍 DEBUG: [save_settings] BEFORE MERGE")
        print(f"  last_ph_check = {preserved_last_ph_check}")
        print(f"  next_ph_check = {preserved_next_ph_check}")
        print(f"  last_pump_activation = {preserved_last_pump_activation}")

        # ✅ Merge updated settings into current settings
        for key, value in updated_settings.items():
            if key == "pin_auth":
                continue  # PIN is managed only by auth module; never overwrite from client
            if isinstance(value, dict) and key in current_settings and isinstance(current_settings[key], dict):
                current_settings[key].update(value)
            else:
                current_settings[key] = value  

        # ✅ Prevent overwriting timestamps with `None`
        if "last_ph_check" not in updated_settings or updated_settings["last_ph_check"] is None:
            current_settings["last_ph_check"] = preserved_last_ph_check

        if "next_ph_check" not in updated_settings or updated_settings["next_ph_check"] is None:
            current_settings["next_ph_check"] = preserved_next_ph_check

        # ✅ Preserve last pump activation unless explicitly updated
        if "last_pump_activation" not in updated_settings or not isinstance(updated_settings["last_pump_activation"], dict):
            current_settings["last_pump_activation"] = preserved_last_pump_activation

        # ✅ Convert datetime values to strings BEFORE saving
        for timestamp_key in ["last_ph_check", "next_ph_check"]:
            if isinstance(current_settings[timestamp_key], datetime):
                current_settings[timestamp_key] = current_settings[timestamp_key].strftime("%Y-%m-%d %I:%M %p")
            elif current_settings[timestamp_key] is None:
                current_settings[timestamp_key] = "N/A"

        if isinstance(current_settings["last_pump_activation"].get("timestamp"), datetime):
            current_settings["last_pump_activation"]["timestamp"] = current_settings["last_pump_activation"]["timestamp"].strftime("%Y-%m-%d %I:%M %p")
        elif current_settings["last_pump_activation"]["timestamp"] is None:
            current_settings["last_pump_activation"]["timestamp"] = "N/A"

        # ✅ Debug: Print final values before saving
        print(f"🔍 DEBUG: [save_settings] FINAL MERGE")
        print(f"  last_ph_check = {current_settings.get('last_ph_check', 'N/A')}")
        print(f"  next_ph_check = {current_settings.get('next_ph_check', 'N/A')}")
        print(f"  last_pump_activation = {current_settings.get('last_pump_activation', 'N/A')}")

        # ✅ Save to JSON file safely
        with open(SETTINGS_FILE, "w") as file:
            json.dump(current_settings, file, indent=4)

        print("✅ Settings saved successfully!")

    except json.JSONDecodeError:
        print("❌ ERROR: Corrupt settings.json detected. Resetting settings.")
        os.rename(SETTINGS_FILE, SETTINGS_FILE + ".backup")
        await save_settings(get_default_settings())

    except ValueError as ve:
        print(f"❌ ERROR: {ve}")

    except Exception as e:
        print(f"❌ ERROR saving settings: {e}")




# ✅ Default Settings
def get_default_settings():
    """Return default settings in case of error."""
    return {
        "dev_mode": False,
        "pH_monitoring_enabled": False,
        "ph_calibration": {
            "mode": "2-point",
            "calibration_points": {
                "2-point": {"ph4_voltage": 3.1, "ph7_voltage": 2.55},
                "3-point": {"ph4_voltage": 3.1, "ph7_voltage": 2.55, "ph10_voltage": 2.1}
            }
        },
        "pump_settings": {
            "low_pH": 5.7,
            "high_pH": 6.3,
            "pump_duration": 5,
            "stabilization_time": 30
        },
        "sensor_intervals": {
            "ph_check_interval": 60,
            "sensor_update_interval": 5
        },
        "oled_page_interval_seconds": 10,
        "oled_config": {
            "pages": [
                {
                    "id": "system_status",
                    "title": "SYSTEM STATUS",
                    "interval_seconds": 10,
                    "enabled": True,
                    "elements": [
                        {"type": "text", "content": "pH Mon: {pH_monitoring_enabled}", "font_size": 12, "color": "white"},
                        {"type": "text", "content": "Range: {low_pH}-{high_pH}", "font_size": 12, "color": "white"}
                    ]
                },
                {
                    "id": "sensor_data",
                    "title": "SENSORS",
                    "interval_seconds": 10,
                    "enabled": True,
                    "elements": [
                        {"type": "text", "content": "pH: {pH_value}  PPM: {ppm_500}", "font_size": 12, "color": "white"},
                        {"type": "text", "content": "Hum: {humidity}%  Air: {air_temperature_f}F", "font_size": 12, "color": "white"},
                        {"type": "text", "content": "Water: {water_temperature_f}F", "font_size": 12, "color": "white"}
                    ]
                },
                {
                    "id": "pump_status",
                    "title": "PUMP STATUS",
                    "interval_seconds": 10,
                    "enabled": True,
                    "elements": [
                        {"type": "text", "content": "Last: {last_pump_activated}", "font_size": 12, "color": "white"},
                        {"type": "text", "content": "Time: {last_pump_time}", "font_size": 12, "color": "white"}
                    ]
                },
                {
                    "id": "ph_check_times",
                    "title": "pH CHECK TIMES",
                    "interval_seconds": 10,
                    "enabled": True,
                    "elements": [
                        {"type": "text", "content": "Last: {last_ph_check}", "font_size": 12, "color": "white"},
                        {"type": "text", "content": "Next: {next_ph_check}", "font_size": 12, "color": "white"}
                    ]
                }
            ]
        },
        # ✅ Ensure timestamps & last pump activation persist as strings
        "last_ph_check": None,
        "next_ph_check": None,
        "influx_config": {},
        "last_pump_activation": {"pump": None, "timestamp": None},
        "ph_voltage": None,
        "pH_value": None,
        "tds_voltage": None,
        "ppm_500": None,
        "light_sensor": {"digital": None, "analog_voltage": None},
        "humidity": None,
        "air_temperature_f": None,
        "water_temperature_f": None
    }


# ✅ Test Load & Save
async def test_settings():
    settings = load_settings()
    print(json.dumps(settings, indent=4))

    # ✅ Save sample settings update
    await save_settings({"ph_voltage": 2.5, "pH_value": 6.8})

# ✅ Run test properly in async context
if __name__ == "__main__":
    asyncio.run(test_settings())
