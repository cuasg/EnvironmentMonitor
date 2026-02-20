import asyncio
import influxdb_client
from influxdb_client.client.write_api import SYNCHRONOUS
from settings import load_settings
import datetime

# Use same config as main app (env / .env). No hardcoded secrets.
try:
    from config import INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET
except ImportError:
    import os
    INFLUX_URL = os.environ.get("INFLUX_URL", "http://localhost:8086")
    INFLUX_TOKEN = os.environ.get("INFLUX_TOKEN", "")
    INFLUX_ORG = os.environ.get("INFLUX_ORG", "HomeSensors")
    INFLUX_BUCKET = os.environ.get("INFLUX_BUCKET", "plantMonitor")

# Initialize InfluxDB client only when configured
client = None
write_api = None
if INFLUX_URL and INFLUX_TOKEN:
    client = influxdb_client.InfluxDBClient(
        url=INFLUX_URL,
        token=INFLUX_TOKEN,
        org=INFLUX_ORG,
    )
    write_api = client.write_api(write_options=SYNCHRONOUS)

# ✅ Store last sent values to avoid unnecessary duplicate writes
last_sent_values = {}

# ✅ Function to Validate Numeric Data
def validate_numeric(value, field_name):
    """Ensure the value is a valid float, otherwise return None."""
    try:
        return round(float(value), 3)
    except (ValueError, TypeError):
        print(f"⚠ WARNING: Invalid numeric value for {field_name}: {value}")
        return None  # Skip invalid values

# ✅ Function to Convert Timestamp to ISO Format
def convert_to_iso(timestamp, field_name):
    """Converts timestamp from 12-hour CST format to ISO format for InfluxDB."""
    if isinstance(timestamp, str):
        try:
            return datetime.datetime.strptime(timestamp, "%Y-%m-%d %I:%M %p").strftime("%Y-%m-%dT%H:%M:%S")
        except ValueError:
            print(f"⚠ WARNING: Invalid timestamp format for {field_name}: {timestamp}")
            return None  # Skip invalid timestamps
    return timestamp  # Return unchanged if already in datetime format

async def log_sensor_data():
    """Fetches sensor data from settings.json and logs it to InfluxDB if updated."""
    if not write_api:
        return  # InfluxDB not configured (no INFLUX_URL/INFLUX_TOKEN in env)
    try:
        settings = load_settings()

        # ✅ Extract and Validate Required Sensor Data
        sensor_data = {
            "ph_voltage": validate_numeric(settings.get("ph_voltage"), "ph_voltage"),
            "pH_value": validate_numeric(settings.get("pH_value"), "pH_value"),
            "tds_voltage": validate_numeric(settings.get("tds_voltage"), "tds_voltage"),
            "ppm_500": validate_numeric(settings.get("ppm_500"), "ppm_500"),
            "light_digital": settings.get("light_sensor", {}).get("digital"),
            "light_analog_voltage": validate_numeric(settings.get("light_sensor", {}).get("analog_voltage"), "light_analog_voltage"),
            "humidity": validate_numeric(settings.get("humidity"), "humidity"),
            "air_temperature_f": validate_numeric(settings.get("air_temperature_f"), "air_temperature_f"),
            "water_temperature_f": validate_numeric(settings.get("water_temperature_f"), "water_temperature_f"),
            "last_ph_check": convert_to_iso(settings.get("last_ph_check"), "last_ph_check"),
            "next_ph_check": convert_to_iso(settings.get("next_ph_check"), "next_ph_check"),
            "last_pump_activation_time": convert_to_iso(settings.get("last_pump_activation", {}).get("timestamp"), "last_pump_activation_time"),
            "last_pump_activated": settings.get("last_pump_activation", {}).get("pump"),
        }

        # ✅ Filter out invalid or unchanged values to avoid redundant writes
        global last_sent_values
        valid_data = {k: v for k, v in sensor_data.items() if v is not None}
        changed_data = {k: v for k, v in valid_data.items() if last_sent_values.get(k) != v}

        if not changed_data:
            print("⏭ No valid changes in sensor data. Skipping InfluxDB write.")
            return

        # ✅ Construct and Write Data to InfluxDB
        point = influxdb_client.Point("sensor_data")
        for key, value in changed_data.items():
            point.field(key, value)

        write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=point)
        print(f"✅ Logged to InfluxDB: {changed_data}")

        # ✅ Update Last Sent Values
        last_sent_values.update(changed_data)

    except Exception as e:
        print(f"❌ ERROR logging sensor data to InfluxDB: {e}")
