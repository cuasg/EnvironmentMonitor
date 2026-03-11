import asyncio
import datetime
import logging
import time
import aiohttp
from settings import load_settings
from config import (
    INFLUX_URL,
    INFLUX_TOKEN,
    INFLUX_ORG,
    INFLUX_BUCKET,
)

# ✅ InfluxDB: config from settings.influx_config with env fallback; lazy client
client = None
write_api = None
_cached_config = None  # (url, token, org, bucket) used to build client
_influx_connection_status = {"connected": False, "error": None}
_influx_activity = {
    "last_write_ok_at": None,
    "last_write_error": None,
    "last_read_ok_at": None,
    "last_read_error": None,
}


def _get_influx_config():
    """Return (url, token, org, bucket) from settings.influx_config with env fallback."""
    settings = load_settings()
    ic = settings.get("influx_config") or {}
    url = (ic.get("url") or "").strip() or INFLUX_URL
    token = (ic.get("token") or "").strip() or INFLUX_TOKEN
    org = (ic.get("org") or "").strip() or INFLUX_ORG
    bucket = (ic.get("bucket") or "").strip() or INFLUX_BUCKET
    return (url, token, org, bucket)


def influx_configured():
    """True if we have enough config (URL and token) from settings or env."""
    url, token, _, _ = _get_influx_config()
    return bool(url and token)


def invalidate_influx_client():
    """Clear cached client so next use picks up current config (e.g. after saving from UI)."""
    global client, write_api, _cached_config
    if client is not None:
        try:
            client.close()
        except Exception:
            pass
    client = None
    write_api = None
    _cached_config = None


def _ensure_client():
    """Create or update InfluxDB client from current config (settings or env)."""
    global client, write_api, _cached_config
    url, token, org, bucket = _get_influx_config()
    if not url or not token:
        return
    current = (url, token, org, bucket)
    if _cached_config == current and client is not None:
        return
    if client is not None:
        try:
            client.close()
        except Exception:
            pass
    try:
        import influxdb_client
        from influxdb_client.client.write_api import SYNCHRONOUS
        client = influxdb_client.InfluxDBClient(url=url, token=token, org=org)
        write_api = client.write_api(write_options=SYNCHRONOUS)
        _cached_config = current
    except Exception as e:
        logging.warning("InfluxDB client init failed: %s", e)
        client = None
        write_api = None
        _cached_config = None


def check_influx_connection():
    """
    Check if InfluxDB connection is valid. Returns (success: bool, error: str or None).
    Updates global _influx_connection_status.
    """
    global _influx_connection_status
    url, token, org, bucket = _get_influx_config()

    if not influx_configured():
        error_msg = "InfluxDB not configured: set URL and token in Control Panel or .env"
        _influx_connection_status = {"connected": False, "error": error_msg}
        return False, error_msg

    _ensure_client()
    if not client:
        error_msg = "InfluxDB client not initialized"
        _influx_connection_status = {"connected": False, "error": error_msg}
        return False, error_msg

    try:
        buckets_api = client.buckets_api()
        buckets_response = buckets_api.find_buckets(org=org)

        buckets_list = None
        if hasattr(buckets_response, 'buckets'):
            buckets_list = buckets_response.buckets
        elif isinstance(buckets_response, list):
            buckets_list = buckets_response
        else:
            try:
                buckets_list = [b for b in buckets_response]
            except (TypeError, AttributeError):
                buckets_list = []

        bucket_names = []
        if buckets_list:
            try:
                bucket_names = [b.name for b in buckets_list]
            except (AttributeError, TypeError):
                pass

        if bucket_names and bucket not in bucket_names:
            error_msg = f"Bucket '{bucket}' not found in org '{org}'. Available: {', '.join(bucket_names)}"
            _influx_connection_status = {"connected": False, "error": error_msg}
            return False, error_msg

        _influx_connection_status = {"connected": True, "error": None}
        return True, None
    except Exception as e:
        error_msg = f"Connection failed: {str(e)}"
        _influx_connection_status = {"connected": False, "error": error_msg}
        return False, error_msg


def get_influx_connection_status():
    """Get current InfluxDB connection status."""
    return _influx_connection_status.copy()


def get_influx_activity():
    """Get last Influx read/write activity for UI indicators."""
    return _influx_activity.copy()

# ✅ Function to Ensure Consistent Data Types
def enforce_type(value, field_name, value_type):
    """
    Converts values to the correct type to prevent InfluxDB errors.
    - value_type = "float": Ensures the value is always a float.
    - value_type = "int": Ensures the value is always an integer.
    """
    if value is None:
        return 0.0 if value_type == "float" else 0
    try:
        if value_type == "float":
            return round(float(value), 3)
        elif value_type == "int":
            return int(value)
    except (ValueError, TypeError):
        logging.debug("Invalid %s value for %s: %s", value_type, field_name, value)
        return 0 if value_type == "int" else 0.0
    return 0.0 if value_type == "float" else 0

# ✅ Function to Convert Timestamp to ISO Format
def convert_to_iso(timestamp, field_name):
    """Converts timestamp from 12-hour CST format to ISO format for InfluxDB."""
    if isinstance(timestamp, str):
        try:
            return datetime.datetime.strptime(timestamp, "%Y-%m-%d %I:%M %p").strftime("%Y-%m-%dT%H:%M:%S")
        except ValueError:
            return None
    return timestamp  # Return unchanged if already in datetime format


async def write_to_influxdb(point):
    """Asynchronously writes the data point to InfluxDB."""
    if not influx_configured():
        logging.warning("InfluxDB not configured; skip write.")
        return
    _ensure_client()
    if not write_api:
        return
    _, _, org, bucket = _get_influx_config()
    try:
        await asyncio.to_thread(write_api.write, bucket=bucket, org=org, record=point)
    except Exception as e:
        logging.error("InfluxDB write error: %s", e)


async def log_sensor_data():
    """Fetches sensor data from settings.json and logs it to InfluxDB.
    Skips writing when dev_mode is True (fake/simulated readings)."""
    try:
        settings = load_settings()
        if settings.get("dev_mode", False):
            return
        if not influx_configured():
            return

        # ✅ Extract and Validate Sensor Data (Ensuring Type Consistency)
        sensor_data = {
            "ph_voltage": enforce_type(settings.get("ph_voltage"), "ph_voltage", "float"),
            "pH_value": enforce_type(settings.get("pH_value"), "pH_value", "float"),
            "tds_voltage": enforce_type(settings.get("tds_voltage"), "tds_voltage", "float"),
            "ppm_500": enforce_type(settings.get("ppm_500"), "ppm_500", "float"),
            "light_digital": enforce_type(settings.get("light_sensor", {}).get("digital"), "light_digital", "int"),
            "light_analog_voltage": enforce_type(settings.get("light_sensor", {}).get("analog_voltage"), "light_analog_voltage", "float"),
            "humidity": enforce_type(settings.get("humidity"), "humidity", "float"),
            "air_temperature_f": enforce_type(settings.get("air_temperature_f"), "air_temperature_f", "float"),
            "water_temperature_f": enforce_type(settings.get("water_temperature_f"), "water_temperature_f", "float"),
            "last_ph_check": convert_to_iso(settings.get("last_ph_check"), "last_ph_check"),
            "next_ph_check": convert_to_iso(settings.get("next_ph_check"), "next_ph_check"),
            "last_pump_activation_time": convert_to_iso(settings.get("last_pump_activation", {}).get("timestamp"), "last_pump_activation_time"),
            "last_pump_activated": settings.get("last_pump_activation", {}).get("pump"),
        }

        ph_val = sensor_data["pH_value"]
        if ph_val is None or not (1.0 <= ph_val <= 14.0):
            return

        # Safe string fields for line protocol (avoid literal None)
        def _str(v):
            return "" if v is None else str(v)

        last_ph = _str(sensor_data["last_ph_check"])
        next_ph = _str(sensor_data["next_ph_check"])
        last_pump_time = _str(sensor_data["last_pump_activation_time"])
        last_pump_activated = _str(sensor_data["last_pump_activated"])

        timestamp = int(time.time() * 1e9)
        line_protocol_data = (
            f"sensor_data,host=plant "
            f"pH_value={sensor_data['pH_value']},ph_voltage={sensor_data['ph_voltage']},tds_voltage={sensor_data['tds_voltage']},ppm_500={sensor_data['ppm_500']},"
            f"light_digital={sensor_data['light_digital']},light_analog_voltage={sensor_data['light_analog_voltage']},humidity={sensor_data['humidity']},"
            f"air_temperature_f={sensor_data['air_temperature_f']},water_temperature_f={sensor_data['water_temperature_f']},"
            f"last_ph_check=\"{last_ph}\",next_ph_check=\"{next_ph}\","
            f"last_pump_activation_time=\"{last_pump_time}\",last_pump_activated=\"{last_pump_activated}\" {timestamp}"
        )

        # ✅ Send the data using aiohttp (asynchronous)
        influx_url, influx_token, influx_org, influx_bucket = _get_influx_config()
        base = influx_url.rstrip("/")
        url = f"{base}/api/v2/write"
        headers = {
            "Authorization": f"Token {influx_token}",
            "Content-Type": "text/plain; charset=utf-8"
        }
        params = {
            "bucket": influx_bucket,
            "org": influx_org
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, params=params, data=line_protocol_data) as response:
                if response.status == 204:
                    _influx_activity["last_write_ok_at"] = time.time()
                    _influx_activity["last_write_error"] = None
                else:
                    body = await response.text()
                    logging.error("InfluxDB write failed: %s %s", response.status, body)
                    _influx_activity["last_write_error"] = body or f"HTTP {response.status}"
    except Exception as e:
        logging.error("Error logging sensor data: %s", e)


# All numeric sensor fields that can be plotted (exclude string/timestamp fields)
TRENDS_AVAILABLE_FIELDS = [
    "pH_value", "ph_voltage", "tds_voltage", "ppm_500",
    "light_digital", "light_analog_voltage",
    "humidity", "air_temperature_f", "water_temperature_f",
]


def query_trends(range_minutes, fields):
    """
    Query InfluxDB for sensor time-series. Returns list of dicts:
    [ {"time": "2026-02-18T12:00:00Z", "pH_value": 6.2, "ppm_500": 240}, ... ]
    Only includes fields that exist in TRENDS_AVAILABLE_FIELDS.
    """
    if not fields:
        return []
    if not influx_configured():
        logging.warning("InfluxDB not configured; trends query skipped.")
        return []
    _ensure_client()
    if not client:
        return []
    _, _, org, bucket = _get_influx_config()
    allowed = set(TRENDS_AVAILABLE_FIELDS)
    requested = [f for f in fields if f in allowed]
    if not requested:
        return []

    query_api = client.query_api()
    field_filter = " or ".join([f'r["_field"] == "{f}"' for f in requested])
    flux = (
        f'from(bucket: "{bucket}") '
        f"|> range(start: -{int(range_minutes)}m) "
        f'|> filter(fn: (r) => r["_measurement"] == "sensor_data") '
        f"|> filter(fn: (r) => {field_filter}) "
        f'|> aggregateWindow(every: 30m, fn: mean, createEmpty: false) '
        f'|> keep(columns: ["_time", "_field", "_value"])'
    )
    try:
        tables = query_api.query(flux, org=org)
        # Pivot: by time -> { field: value }
        by_time = {}
        for table in tables:
            for record in table.records:
                t = record.get_time()
                if t is None:
                    continue
                # Use ISO format for JSON
                time_key = t.strftime("%Y-%m-%dT%H:%M:%SZ") if hasattr(t, "strftime") else str(t)
                field = record.get_field()
                value = record.get_value()
                if time_key not in by_time:
                    by_time[time_key] = {"time": time_key}
                try:
                    by_time[time_key][field] = float(value)
                except (TypeError, ValueError):
                    by_time[time_key][field] = value
        result = sorted(by_time.values(), key=lambda x: x["time"])
        _influx_activity["last_read_ok_at"] = time.time()
        _influx_activity["last_read_error"] = None
        return result
    except Exception as e:
        logging.error("Trends query error: %s", e)
        _influx_activity["last_read_error"] = str(e)
        return []
