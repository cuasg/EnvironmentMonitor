import asyncio
import influxdb_client
from influxdb_client.client.write_api import SYNCHRONOUS
from settings import load_settings
import datetime

# ✅ InfluxDB Configuration
INFLUX_URL = "http://10.0.0.249:8086"
INFLUX_BUCKET = "plantMonitor"
INFLUX_ORG = "HomeSensors"
INFLUX_TOKEN = "BwI7LzY7VZktTpY7LqnDkb4RI5TOr6bor1n-4cy9Xf5QvG-ILXjazbk5oHWuwMC0ajQR08LclccWKkgBitzN5w=="  # 🚨 Replace with your actual token

# ✅ Initialize InfluxDB Client
client = influxdb_client.InfluxDBClient(
    url=INFLUX_URL,
    token=INFLUX_TOKEN,
    org=INFLUX_ORG
)

write_api = client.write_api(write_options=SYNCHRONOUS)

# ✅ Store last sent values to avoid unnecessary duplicate writes
last_sent_values = {}

import datetime

async def log_sensor_data():
    """Fetches sensor data from settings.json and logs it to InfluxDB if updated."""
    try:
        settings = load_settings()

        # ✅ Extract required sensor data
        sensor_data = {
            "ph_voltage": settings.get("ph_voltage"),
            "pH_value": settings.get("pH_value"),
            "tds_voltage": settings.get("tds_voltage"),
            "ppm_500": settings.get("ppm_500"),
            "light_digital": settings.get("light_sensor", {}).get("digital"),
            "light_analog_voltage": settings.get("light_sensor", {}).get("analog_voltage"),
            "humidity": settings.get("humidity"),
            "air_temperature_f": settings.get("air_temperature_f"),
            "water_temperature_f": settings.get("water_temperature_f"),
            "last_ph_check": settings.get("last_ph_check"),
            "next_ph_check": settings.get("next_ph_check"),
            "last_pump_activation_time": settings.get("last_pump_activation", {}).get("timestamp"),
            "last_pump_activated": settings.get("last_pump_activation", {}).get("pump"),
        }

        # ✅ Convert timestamps ONLY for InfluxDB (Keep original format in settings.json)
        def convert_to_iso(timestamp):
            """Converts timestamp from 12-hour CST format to ISO format for InfluxDB."""
            if isinstance(timestamp, str):
                try:
                    return datetime.datetime.strptime(timestamp, "%Y-%m-%d %I:%M %p").strftime("%Y-%m-%dT%H:%M:%S")
                except ValueError:
                    print(f"⚠ WARNING: Invalid timestamp format for {timestamp}, keeping as is.")
                    return timestamp  # Keep original value if conversion fails
            return timestamp  # Return unchanged if already in datetime format

        # ✅ Apply conversion to relevant fields **only for InfluxDB writes**
        sensor_data["last_ph_check"] = convert_to_iso(sensor_data["last_ph_check"])
        sensor_data["next_ph_check"] = convert_to_iso(sensor_data["next_ph_check"])
        sensor_data["last_pump_activation_time"] = convert_to_iso(sensor_data["last_pump_activation_time"])

        # ✅ Filter out unchanged values to avoid redundant writes
        global last_sent_values
        changed_data = {k: v for k, v in sensor_data.items() if last_sent_values.get(k) != v and v is not None}

        if not changed_data:
            print("⏭ No changes in sensor data. Skipping InfluxDB write.")
            return

        # ✅ Construct InfluxDB data point
        point = influxdb_client.Point("sensor_data")
        for key, value in changed_data.items():
            point.field(key, value)

        # ✅ Write to InfluxDB
        write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=point)
        print("✅ Sensor data logged to InfluxDB!")

        # ✅ Update last sent values
        last_sent_values.update(changed_data)

    except Exception as e:
        print(f"❌ Error logging sensor data to InfluxDB: {e}")


