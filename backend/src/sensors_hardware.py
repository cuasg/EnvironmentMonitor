"""
Hardware-dependent sensor reads. Only imported when dev_mode is False.
Uses board, busio, ADS1115, W1ThermSensor, DHT22 - will fail off-Pi if imported without hardware.
"""
import asyncio
import time
import board
import busio
import w1thermsensor
from adafruit_ads1x15.analog_in import AnalogIn
from adafruit_ads1x15.ads1115 import ADS1115
import adafruit_dht
from settings import load_settings, save_settings

# I2C setup for ADS1115 (pH & TDS sensors)
i2c = busio.I2C(board.SCL, board.SDA)
ads = ADS1115(i2c)

# DS18B20 Water Temperature Sensor
ds18b20 = w1thermsensor.W1ThermSensor()

# DHT22 Sensor Setup (CircuitPython)
DHT_PIN = board.D5
dht_sensor = adafruit_dht.DHT22(DHT_PIN)

NUM_SAMPLES = 5
TOLERANCE_RANGE = (2.0, 3.1)
PH_MIN_VOLTAGE = 1.9
PH_MAX_VOLTAGE = 4.0


def c_to_f(temp_c):
    return round((temp_c * 9/5) + 32, 2)


async def convert_ph(voltage, calibration_data):
    try:
        mode = calibration_data.get("mode", "2-point")
        cal_points = calibration_data.get("calibration_points", {})

        if mode not in cal_points:
            print(f"⚠ ERROR: Calibration mode '{mode}' not found in 'calibration_points'!")
            return None

        cal_set = cal_points.get(mode, {})
        ph4_voltage = cal_set.get("ph4_voltage")
        ph7_voltage = cal_set.get("ph7_voltage")
        ph10_voltage = cal_set.get("ph10_voltage") if mode == "3-point" else None

        if ph4_voltage is None or ph7_voltage is None or (mode == "3-point" and ph10_voltage is None):
            print(f"⚠ Warning: Missing {mode} calibration values!")
            return None

        valid_readings = []
        for _ in range(NUM_SAMPLES):
            reading = voltage
            if reading is not None and TOLERANCE_RANGE[0] <= reading <= TOLERANCE_RANGE[1]:
                valid_readings.append(reading)
            await asyncio.sleep(0.2)

        if not valid_readings:
            print("❌ ERROR: No valid readings within tolerance range.")
            return None

        avg_voltage = sum(valid_readings) / len(valid_readings)

        if mode == "3-point" and ph10_voltage is not None:
            if avg_voltage >= ph7_voltage:
                slope = (10.0 - 7.0) / (ph10_voltage - ph7_voltage)
                ph_value = slope * (avg_voltage - ph7_voltage) + 7.0
            else:
                slope = (7.0 - 4.0) / (ph7_voltage - ph4_voltage)
                ph_value = slope * (avg_voltage - ph7_voltage) + 7.0
        else:
            slope = (7.0 - 4.0) / (ph7_voltage - ph4_voltage)
            ph_value = slope * (avg_voltage - ph7_voltage) + 7.0

        ph_value = round(ph_value, 1)
        return max(1.0, min(14.0, ph_value))

    except Exception as e:
        print(f"❌ Error converting pH: {e}")
        return None


def calculate_ph(voltage, calibration_data):
    try:
        mode = calibration_data.get("mode", "2-point")
        cal_points = calibration_data.get("calibration_points", {})

        if mode not in cal_points:
            print(f"⚠ ERROR: Calibration mode '{mode}' not found in 'calibration_points'!")
            return None

        cal_set = cal_points.get(mode, {})
        ph4_voltage = cal_set.get("ph4_voltage")
        ph7_voltage = cal_set.get("ph7_voltage")
        ph10_voltage = cal_set.get("ph10_voltage") if mode == "3-point" else None

        if ph4_voltage is None or ph7_voltage is None or (mode == "3-point" and ph10_voltage is None):
            print(f"⚠ Warning: Missing {mode} calibration values!")
            return None

        if mode == "3-point" and ph10_voltage is not None:
            if voltage >= ph7_voltage:
                slope = (10.0 - 7.0) / (ph10_voltage - ph7_voltage)
                intercept = 7.0 - (slope * ph7_voltage)
                ph_value = slope * voltage + intercept
            else:
                slope = (7.0 - 4.0) / (ph7_voltage - ph4_voltage)
                intercept = 7.0 - (slope * ph7_voltage)
                ph_value = slope * voltage + intercept
        else:
            slope = (7.0 - 4.0) / (ph7_voltage - ph4_voltage)
            intercept = 7.0 - (slope * ph7_voltage)
            ph_value = slope * voltage + intercept

        return round(ph_value, 1)

    except Exception as e:
        print(f"❌ Error converting pH: {e}")
        return None


def convert_tds(voltage, temp_c):
    compensation_coefficient = 1.0 + 0.02 * (25.0 - temp_c)
    compensated_voltage = voltage / compensation_coefficient
    ppm_500 = (
        133.42 * compensated_voltage**3
        - 255.86 * compensated_voltage**2
        + 857.39 * compensated_voltage
    ) * 0.5
    return round(ppm_500, 2)


def read_dht_sensor():
    max_retries = 10
    attempt = 0

    while attempt < max_retries:
        try:
            temperature_c = dht_sensor.temperature
            humidity = dht_sensor.humidity

            if temperature_c is not None and humidity is not None:
                return {
                    "temperature_f": c_to_f(temperature_c),
                    "humidity": round(humidity + 11.5, 2)
                }

        except RuntimeError as e:
            if attempt == 0:
                print(f"⚠ WARNING: DHT sensor error: {e}. Retrying...")

        except Exception as e:
            print(f"❌ ERROR: Exception occurred while reading DHT sensor: {e}")
            break

        attempt += 1
        time.sleep(2)

    print("❌ ERROR: Failed to read DHT sensor after multiple attempts!")
    return None


async def read_ds18b20():
    try:
        temp_c = ds18b20.get_temperature()
        return c_to_f(temp_c)
    except Exception as e:
        print(f"❌ Error reading DS18B20 sensor: {e}")
        return None


# Max time to wait for pH voltage in valid range (avoid infinite loop if sensor disconnected)
PH_READ_TIMEOUT_SEC = 60

async def read_ph_sensor():
    try:
        settings = load_settings()
        calibration_data = settings.get("ph_calibration", {})
        start = time.monotonic()

        while True:
            if time.monotonic() - start > PH_READ_TIMEOUT_SEC:
                print("⚠ pH sensor: timeout waiting for voltage in range (check probe connection).")
                return None, None
            ph_voltage = AnalogIn(ads, 0).voltage
            if PH_MIN_VOLTAGE <= ph_voltage <= PH_MAX_VOLTAGE:
                ph_value = await convert_ph(ph_voltage, calibration_data)
                return round(ph_voltage, 3), ph_value
            await asyncio.sleep(0.5)
    except Exception as e:
        print(f"❌ Error reading pH sensor: {e}")
        return None, None


async def read_tds_sensor(water_temp_c):
    try:
        tds_voltage = AnalogIn(ads, 1).voltage
        ppm_500 = convert_tds(tds_voltage, water_temp_c)
        return round(tds_voltage, 3), ppm_500
    except Exception as e:
        print(f"❌ Error reading TDS sensor: {e}")
        return None, None


async def read_light_sensor():
    try:
        light_state = AnalogIn(ads, 2).voltage
        return {"digital": 1 if light_state > 2.5 else 0, "analog_voltage": round(light_state, 3)}
    except Exception as e:
        print(f"❌ Error reading light sensor: {e}")
        return None


async def average_ph_readings():
    try:
        ph_voltages = []
        print("📡 Starting 60-second pH averaging...")

        for i in range(60):
            settings = load_settings()
            if not settings.get("pH_monitoring_enabled", False):
                print("⏹️ pH Monitoring Disabled! Stopping averaging early.")
                return None, None

            ph_voltage, _ = await read_ph_sensor()

            if ph_voltage is not None:
                ph_voltages.append(ph_voltage)
                print(f"📊 [{i+1}/60] pH Voltage Collected: {ph_voltage:.3f}V")
            else:
                print(f"⚠ Skipping invalid pH reading...")

            await asyncio.sleep(1)

        if len(ph_voltages) < 10:
            print(f"❌ ERROR: Only {len(ph_voltages)}/60 valid pH readings collected. Aborting.")
            return None, None

        avg_voltage = sum(ph_voltages) / len(ph_voltages)
        print(f"✅ Averaged pH Voltage: {avg_voltage:.3f}V")

        settings = load_settings()
        calibration_data = settings.get("ph_calibration", {})

        if not calibration_data or "calibration_points" not in calibration_data:
            print("⚠ ERROR: Missing calibration data. Cannot convert voltage to pH.")
            return avg_voltage, None

        avg_pH = calculate_ph(avg_voltage, calibration_data)
        print(f"✅ Averaged pH Value: {avg_pH:.1f}")

        updated_data = {
            "ph_voltage": avg_voltage,
            "pH_value": avg_pH
        }
        await save_settings(updated_data)

        print("✅ Averaged pH data saved to settings.json!")
        return avg_voltage, avg_pH

    except Exception as e:
        print(f"❌ Error averaging pH readings: {e}")
        return None, None


async def read_all_sensors():
    """Read all hardware sensors. Only updates settings for successful reads; keeps existing values on failure."""
    try:
        settings = load_settings()
        # Start from current settings so failed reads don't overwrite good cached values
        updated_sensor_data = dict(settings)
        # Always preserve these (do not overwrite with sensor read)
        preserved_last_ph_check = settings.get("last_ph_check", "N/A")
        preserved_next_ph_check = settings.get("next_ph_check", "N/A")
        preserved_last_pump_activation = settings.get("last_pump_activation", {"pump": None, "timestamp": "N/A"})

        # pH
        try:
            ph_data = await read_ph_sensor()
            if ph_data and isinstance(ph_data, tuple) and ph_data[0] is not None:
                updated_sensor_data["ph_voltage"] = ph_data[0]
                if ph_data[1] is not None:
                    updated_sensor_data["pH_value"] = ph_data[1]
        except Exception as e:
            print(f"⚠ pH read failed: {e}")

        # DHT (air temp, humidity)
        try:
            dht_data = read_dht_sensor()
            if dht_data:
                updated_sensor_data["air_temperature_f"] = dht_data.get("temperature_f")
                updated_sensor_data["humidity"] = dht_data.get("humidity")
        except Exception as e:
            print(f"⚠ DHT read failed: {e}")

        # Water temp (DS18B20) — needed for TDS compensation
        water_temperature_f = settings.get("water_temperature_f", 77.0)
        if not isinstance(water_temperature_f, (int, float)):
            water_temperature_f = 77.0
        try:
            w = await read_ds18b20()
            if w is not None:
                water_temperature_f = w
                updated_sensor_data["water_temperature_f"] = w
        except Exception as e:
            print(f"⚠ DS18B20 read failed: {e}")

        # TDS (needs water temp in °C)
        try:
            water_temp_c = (float(water_temperature_f) - 32) * (5 / 9)
            tds_data = await read_tds_sensor(water_temp_c)
            if tds_data and isinstance(tds_data, tuple) and tds_data[0] is not None:
                updated_sensor_data["tds_voltage"] = tds_data[0]
                updated_sensor_data["ppm_500"] = tds_data[1]
        except Exception as e:
            print(f"⚠ TDS read failed: {e}")

        # Light
        try:
            light_data = await read_light_sensor()
            if light_data is not None:
                updated_sensor_data["light_sensor"] = light_data
        except Exception as e:
            print(f"⚠ Light sensor read failed: {e}")

        # Restore preserved fields
        if preserved_last_ph_check != "N/A":
            updated_sensor_data["last_ph_check"] = preserved_last_ph_check
        if preserved_next_ph_check != "N/A":
            updated_sensor_data["next_ph_check"] = preserved_next_ph_check
        if preserved_last_pump_activation.get("timestamp") != "N/A" or preserved_last_pump_activation.get("pump") is not None:
            updated_sensor_data["last_pump_activation"] = preserved_last_pump_activation

        await save_settings(updated_sensor_data)
        return updated_sensor_data
    except Exception as e:
        print(f"❌ ERROR: Failed to read sensors: {e}")
        return None
