import asyncio
import board
import busio
import os
import w1thermsensor
from datetime import datetime
from adafruit_ads1x15.analog_in import AnalogIn
from adafruit_ads1x15.ads1115 import ADS1115
import adafruit_dht  # ✅ Using CircuitPython for DHT22
import time
from settings import load_settings


# ✅ Import settings management
from settings import load_settings, save_settings

# ✅ I2C setup for ADS1115 (pH & TDS sensors)
i2c = busio.I2C(board.SCL, board.SDA)
ads = ADS1115(i2c)

# ✅ DS18B20 Water Temperature Sensor
ds18b20 = w1thermsensor.W1ThermSensor()

# ✅ DHT22 Sensor Setup (Using CircuitPython)
DHT_PIN = board.D5  # Change if using a different GPIO pin
dht_sensor = adafruit_dht.DHT22(DHT_PIN)

# ✅ Light Sensor
LIGHT_SENSOR_PIN = 22


# ✅ Converts Celsius to Fahrenheit
def c_to_f(temp_c):
    return round((temp_c * 9/5) + 32, 2)


# ✅ pH Conversion - Uses exact formulas provided
def convert_ph(voltage, calibration_data):
    """Converts pH sensor voltage using 2-point or 3-point calibration."""
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

        return round(ph_value, 3)

    except Exception as e:
        print(f"❌ Error converting pH: {e}")
        return None


# ✅ TDS Conversion - Uses exact formula provided
def convert_tds(voltage, temp_c):
    compensation_coefficient = 1.0 + 0.02 * (25.0 - temp_c)
    compensated_voltage = voltage / compensation_coefficient
    ppm_500 = (
        133.42 * compensated_voltage**3
        - 255.86 * compensated_voltage**2
        + 857.39 * compensated_voltage
    ) * 0.5
    return round(ppm_500, 2)


# ✅ Read DHT22 Sensor (Using CircuitPython)
import time

def read_dht_sensor():
    """Reads temperature and humidity from the DHT22 sensor with retry logic."""
    max_retries = 10  # ✅ Max attempts before giving up
    attempt = 0

    while attempt < max_retries:
        try:
            temperature_c = dht_sensor.temperature
            humidity = dht_sensor.humidity

            if temperature_c is not None and humidity is not None:
                return {
                    "temperature_f": c_to_f(temperature_c),
                    "humidity": round(humidity, 2)
                }

        except RuntimeError as e:
            if attempt == 0:  # ✅ Only log the first error to prevent spam
                print(f"⚠ WARNING: DHT sensor error: {e}. Retrying...")
        
        except Exception as e:
            print(f"❌ ERROR: Exception occurred while reading DHT sensor: {e}")
            break  # ✅ Exit loop immediately for unexpected errors

        attempt += 1
        time.sleep(2)  # ✅ Wait 2 seconds before retrying

    print("❌ ERROR: Failed to read DHT sensor after multiple attempts!")
    return None  # ✅ Ensures None is returned only if completely unsuccessful


# ✅ Read DS18B20 (Water Temperature)
async def read_ds18b20():
    try:
        temp_c = ds18b20.get_temperature()
        return c_to_f(temp_c)
    except Exception as e:
        print(f"❌ Error reading DS18B20 sensor: {e}")
        return None




# ✅ Define pH Voltage Valid Range
PH_MIN_VOLTAGE = 1.9
PH_MAX_VOLTAGE = 4.0

# ✅ Read pH Sensor (ADS1115)
def read_ph_sensor():
    """Reads the pH sensor and converts it using calibration values, ensuring valid voltage range."""
    try:
        settings = load_settings()
        calibration_data = settings.get("ph_calibration", {})

        while True:
            ph_voltage = AnalogIn(ads, 0).voltage  # Read from ADS1115 channel 0
            
            # ✅ Check if voltage is within valid range
            if PH_MIN_VOLTAGE <= ph_voltage <= PH_MAX_VOLTAGE:
                ph_value = convert_ph(ph_voltage, calibration_data)
                return ph_voltage, ph_value
            else:
                #print(f"⚠ Invalid pH voltage: {ph_voltage:.3f}V - Retrying...")
                time.sleep(0.5)  # ✅ Small delay before retrying

    except Exception as e:
        print(f"❌ Error reading pH sensor: {e}")
        return None, None

async def average_ph_readings():
    """Takes 60 valid pH readings, averages them, calculates pH, and updates settings.json."""
    try:
        ph_voltages = []
        print("📡 Starting 60-second pH averaging...")

        for i in range(60):
            # ✅ Check if pH monitoring has been disabled
            settings = load_settings()
            if not settings.get("pH_monitoring_enabled", False):
                print("⏹️ pH Monitoring Disabled! Stopping averaging early.")
                return None, None  # ✅ Exit immediately if monitoring is disabled

            # ✅ Read pH voltage (No `await` needed for non-async function)
            ph_voltage, _ = read_ph_sensor()  # This function returns (voltage, pH_value)

            if ph_voltage is not None:
                ph_voltages.append(ph_voltage)
                print(f"📊 [{i+1}/60] pH Voltage Collected: {ph_voltage:.3f}V")
            else:
                print(f"⚠ Skipping invalid pH reading...")

            await asyncio.sleep(1)  # ✅ Take a reading every second

        if len(ph_voltages) < 10:  # ✅ Ensure at least 10 valid readings
            print(f"❌ ERROR: Only {len(ph_voltages)}/60 valid pH readings collected. Aborting.")
            return None, None

        # ✅ Compute average voltage
        avg_voltage = sum(ph_voltages) / len(ph_voltages)
        print(f"✅ Averaged pH Voltage: {avg_voltage:.3f}V")

        # ✅ Load calibration settings
        settings = load_settings()
        calibration_data = settings.get("ph_calibration", {})

        # ✅ Ensure calibration data is valid before conversion
        if not calibration_data or "calibration_points" not in calibration_data:
            print("⚠ ERROR: Missing calibration data. Cannot convert voltage to pH.")
            return avg_voltage, None

        # ✅ Convert averaged voltage to pH value
        avg_pH = convert_ph(avg_voltage, calibration_data)
        print(f"✅ Averaged pH Value: {avg_pH:.2f}")

        # ✅ Save the averaged pH value to settings.json
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



# ✅ Read TDS Sensor (ADS1115)
async def read_tds_sensor(water_temp_c):
    try:
        tds_voltage = AnalogIn(ads, 1).voltage
        ppm_500 = convert_tds(tds_voltage, water_temp_c)
        return round(tds_voltage, 3), ppm_500
    except Exception as e:
        print(f"❌ Error reading TDS sensor: {e}")
        return None, None


# ✅ Read Light Sensor (Digital + Analog)
async def read_light_sensor():
    try:
        light_state = AnalogIn(ads, 2).voltage
        return {"digital": 1 if light_state > 2.5 else 0, "analog_voltage": round(light_state, 3)}
    except Exception as e:
        print(f"❌ Error reading light sensor: {e}")
        return None


# ✅ Read All Sensors and Update settings.json
async def read_all_sensors():
    """Reads all sensor data asynchronously and updates settings.json."""
    try:
        # ✅ Load current settings FIRST to preserve existing timestamps & pump activation
        settings = load_settings()

        # ✅ Preserve timestamps & pump activation BEFORE reading new data
        preserved_last_ph_check = settings.get("last_ph_check", "N/A")
        preserved_next_ph_check = settings.get("next_ph_check", "N/A")
        preserved_last_pump_activation = settings.get("last_pump_activation", {"pump": None, "timestamp": "N/A"})

        print("\n🔍 DEBUG: [read_all_sensors] Preserved BEFORE Reading Sensors")
        print(f"  last_ph_check = {preserved_last_ph_check}")
        print(f"  next_ph_check = {preserved_next_ph_check}")
        print(f"  last_pump_activation = {preserved_last_pump_activation}")

        # ✅ Read pH sensor (Non-async, do NOT use `await`)
        print("🔍 DEBUG: Reading pH sensor...")
        ph_data = read_ph_sensor()
        print(f"✅ pH Data: {ph_data}")

        # ✅ Read DHT sensor (Non-async, do NOT use `await`)
        print("🔍 DEBUG: Reading DHT sensor...")
        dht_data = read_dht_sensor()
        print(f"✅ DHT Data: {dht_data}")

        # ✅ Read DS18B20 Water Temperature (Async, `await` required)
        print("🔍 DEBUG: Reading DS18B20 water temperature sensor...")
        water_temperature_f = await read_ds18b20()
        print(f"✅ Water Temperature (°F): {water_temperature_f}")

        # ✅ Handle None case for water temp
        if water_temperature_f is None:
            water_temperature_f = 77.0  # Default value (25°C)

        # ✅ Read TDS sensor (Async, requires `await`)
        print("🔍 DEBUG: Reading TDS sensor...")
        water_temp_c = (water_temperature_f - 32) * (5/9)
        tds_data = await read_tds_sensor(water_temp_c)
        print(f"✅ TDS Data: {tds_data}")

        # ✅ Read Light Sensor (Async, requires `await`)
        print("🔍 DEBUG: Reading Light sensor...")
        light_data = await read_light_sensor()
        print(f"✅ Light Sensor Data: {light_data}")

        # ✅ Extract tuple values correctly
        ph_voltage, pH_value = ph_data if isinstance(ph_data, tuple) else (None, None)
        tds_voltage, ppm_500 = tds_data if isinstance(tds_data, tuple) else (None, None)

        # ✅ Ensure all sensor data is properly structured before updating settings
        updated_sensor_data = {
            "ph_voltage": ph_voltage,
            "pH_value": pH_value,
            "tds_voltage": tds_voltage,
            "ppm_500": ppm_500,
            "light_sensor": light_data if light_data is not None else {"digital": None, "analog_voltage": None},
            "humidity": dht_data.get("humidity") if dht_data is not None else settings.get("humidity", "N/A"),
            "air_temperature_f": dht_data.get("temperature_f") if dht_data is not None else settings.get("air_temperature_f", "N/A"),
            "water_temperature_f": water_temperature_f if water_temperature_f is not None else settings.get("water_temperature_f", "N/A"),
        }

        # ✅ Preserve timestamps and last pump activation **without overwriting**
        if preserved_last_ph_check != "N/A":
            updated_sensor_data["last_ph_check"] = preserved_last_ph_check

        if preserved_next_ph_check != "N/A":
            updated_sensor_data["next_ph_check"] = preserved_next_ph_check

        if preserved_last_pump_activation["timestamp"] != "N/A" or preserved_last_pump_activation["pump"] is not None:
            updated_sensor_data["last_pump_activation"] = preserved_last_pump_activation

        # ✅ Debug: Print final values before saving
        print(f"🔍 DEBUG: [read_all_sensors] FINAL VALUES TO SAVE (Preserving timestamps & pump activation):")
        print(updated_sensor_data)

        await save_settings(updated_sensor_data)
        print("✅ Sensor data saved successfully!")

        return updated_sensor_data  

    except Exception as e:
        print(f"❌ ERROR: Failed to read sensors: {e}")
        return None




# ✅ Test Sensor Readings
if __name__ == "__main__":
    asyncio.run(read_all_sensors())
