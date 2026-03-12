import json
import os
import asyncio
import logging
from datetime import datetime

import pytz

logger = logging.getLogger(__name__)

DEFAULT_TIMEZONE = "America/Chicago"

# Use env if set; otherwise same directory as this file (works on Pi and WSL)
_SETTINGS_DIR = os.environ.get(
    "PLANT_SETTINGS_DIR",
    os.path.dirname(os.path.abspath(__file__)),
)
SETTINGS_FILE = os.path.join(_SETTINGS_DIR, "settings.json")
BACKUP_FILE = os.path.join(_SETTINGS_DIR, "settings_backup.json")

# In-memory cache for Pi Zero efficiency - invalidated on save
_settings_cache = None


def invalidate_settings_cache():
    """Call when settings are written so next load reads fresh from disk."""
    global _settings_cache
    _settings_cache = None


def get_display_tz():
    """Return the app's display timezone (pytz) from settings. Used for all user-facing timestamps."""
    try:
        tz_name = load_settings().get("timezone", DEFAULT_TIMEZONE) or DEFAULT_TIMEZONE
        return pytz.timezone(str(tz_name))
    except Exception:
        return pytz.timezone(DEFAULT_TIMEZONE)


# ✅ Ensure timestamps are stored as strings in settings.json
def ensure_datetime(value):
    if isinstance(value, str):
        try:
            return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None
    return value if isinstance(value, datetime) else None



# ✅ Load Settings (No Async) - cached for Pi Zero efficiency
def load_settings():
    """Load settings from the JSON file, ensuring proper formatting. Uses in-memory cache."""
    global _settings_cache
    if _settings_cache is not None:
        return _settings_cache
    if not os.path.exists(SETTINGS_FILE):
        logger.warning("Settings file missing; creating default settings.")
        settings = get_default_settings()
        with open(SETTINGS_FILE, "w") as file:
            json.dump(settings, file, indent=4)
        _settings_cache = settings
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

        settings["last_ph_check"] = last_ph_check if parsed_last_ph_check is None else parsed_last_ph_check.strftime("%Y-%m-%d %I:%M:%S %p")
        settings["next_ph_check"] = next_ph_check if parsed_next_ph_check is None else parsed_next_ph_check.strftime("%Y-%m-%d %I:%M:%S %p")

        # ✅ Ensure last_pump_activation exists and preserve timestamp
        if "last_pump_activation" not in settings or not isinstance(settings["last_pump_activation"], dict):
            settings["last_pump_activation"] = {"pump": None, "timestamp": "N/A"}
        else:
            last_pump_timestamp = settings["last_pump_activation"].get("timestamp", "N/A")
            parsed_pump_timestamp = ensure_datetime(last_pump_timestamp)
            settings["last_pump_activation"]["timestamp"] = last_pump_timestamp if parsed_pump_timestamp is None else parsed_pump_timestamp.strftime("%Y-%m-%d %I:%M:%S %p")

        # ✅ Merge in critical defaults when missing or malformed
        default_settings = get_default_settings()

        # OLED config
        if "oled_config" not in settings or not isinstance(settings["oled_config"], dict) or not settings["oled_config"].get("pages"):
            logger.debug("OLED config missing or empty, merging defaults")
            settings["oled_config"] = default_settings.get("oled_config", {})

        # Pump settings
        pump_settings = settings.get("pump_settings")
        if not isinstance(pump_settings, dict):
            logger.warning("pump_settings missing or invalid in settings.json; applying defaults.")
            settings["pump_settings"] = default_settings.get("pump_settings", {}).copy()
        else:
            merged = default_settings.get("pump_settings", {}).copy()
            merged.update({k: v for k, v in pump_settings.items() if v is not None})
            settings["pump_settings"] = merged

        # Sensor intervals (ensure new fields like ph_min_samples exist)
        sensor_intervals = settings.get("sensor_intervals")
        if not isinstance(sensor_intervals, dict):
            settings["sensor_intervals"] = default_settings.get("sensor_intervals", {}).copy()
        else:
            merged_intervals = default_settings.get("sensor_intervals", {}).copy()
            merged_intervals.update({k: v for k, v in sensor_intervals.items() if v is not None})
            settings["sensor_intervals"] = merged_intervals

        # Ensure new fields like last_ph_check_start / ph_check_started_at / ph_check_ended_at / ph_check_active / timezone exist
        if "last_ph_check_start" not in settings:
            settings["last_ph_check_start"] = default_settings.get("last_ph_check_start")
        if "ph_check_started_at" not in settings:
            settings["ph_check_started_at"] = default_settings.get("ph_check_started_at")
        if "ph_check_ended_at" not in settings:
            settings["ph_check_ended_at"] = default_settings.get("ph_check_ended_at")
        if "ph_check_active" not in settings:
            settings["ph_check_active"] = default_settings.get("ph_check_active")
        if "timezone" not in settings or not settings.get("timezone"):
            settings["timezone"] = default_settings.get("timezone", DEFAULT_TIMEZONE)

        _settings_cache = settings
        return settings

    except json.JSONDecodeError:
        logger.error("Corrupt settings.json detected; creating backup and resetting")
        os.rename(SETTINGS_FILE, BACKUP_FILE)
        settings = get_default_settings()
        with open(SETTINGS_FILE, "w") as file:
            json.dump(settings, file, indent=4)
        _settings_cache = settings
        return settings

    except Exception as e:
        logger.error("Unexpected error loading settings: %s", e)
        return get_default_settings()



# ✅ Save Settings (Proper Async Handling)
async def save_settings(updated_settings):
    """Save settings without overwriting non-changing values."""
    global _settings_cache
    try:
        invalidate_settings_cache()
        if not isinstance(updated_settings, dict):
            updated_settings = {}

        current_settings = load_settings()
        preserved_last_ph_check = current_settings.get("last_ph_check", "N/A")
        preserved_next_ph_check = current_settings.get("next_ph_check", "N/A")
        preserved_last_pump_activation = current_settings.get("last_pump_activation", {"pump": None, "timestamp": "N/A"})

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

        # ✅ Convert datetime values to strings BEFORE saving (with seconds: HH:MM:SS)
        for timestamp_key in ["last_ph_check", "next_ph_check"]:
            if isinstance(current_settings[timestamp_key], datetime):
                current_settings[timestamp_key] = current_settings[timestamp_key].strftime("%Y-%m-%d %I:%M:%S %p")
            elif current_settings[timestamp_key] is None:
                current_settings[timestamp_key] = "N/A"

        if isinstance(current_settings["last_pump_activation"].get("timestamp"), datetime):
            current_settings["last_pump_activation"]["timestamp"] = current_settings["last_pump_activation"]["timestamp"].strftime("%Y-%m-%d %I:%M:%S %p")
        elif current_settings["last_pump_activation"]["timestamp"] is None:
            current_settings["last_pump_activation"]["timestamp"] = "N/A"

        with open(SETTINGS_FILE, "w") as file:
            json.dump(current_settings, file, indent=4)
        _settings_cache = current_settings

    except json.JSONDecodeError:
        logger.error("Corrupt settings.json detected; resetting settings")
        os.rename(SETTINGS_FILE, SETTINGS_FILE + ".backup")
        await save_settings(get_default_settings())

    except ValueError as ve:
        logger.error("Settings save error: %s", ve)
        raise
    except Exception as e:
        logger.error("Error saving settings: %s", e)
        raise




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
            "sensor_update_interval": 5,
            "ph_average_window_minutes": 5,
            "ph_min_samples": 10,
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
        "last_ph_check_start": None,
        "ph_check_started_at": None,
        "ph_check_ended_at": None,
        "ph_check_active": False,
        "timezone": DEFAULT_TIMEZONE,
        "influx_config": {},
        "last_pump_activation": {"pump": None, "timestamp": None},
        "dev_ph_min": 5.8,
        "dev_ph_max": 6.5,
        "sensors_available": True,
        "sensors_unavailable_reason": None,
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
