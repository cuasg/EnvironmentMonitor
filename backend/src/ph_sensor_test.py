import time
import board
import busio
import json
import sys
from adafruit_ads1x15.analog_in import AnalogIn
from adafruit_ads1x15.ads1115 import ADS1115

# ✅ Load Calibration Data from settings.json
SETTINGS_FILE = "/home/cuasg/plant/backend/src/settings.json"

def load_calibration():
    """Load pH calibration data from settings.json."""
    try:
        with open(SETTINGS_FILE, "r") as file:
            settings = json.load(file)
            return settings.get("ph_calibration", {})
    except Exception as e:
        print(f"\n❌ ERROR: Failed to load calibration data: {e}")
        return {}

# ✅ pH Conversion Function (Uses 2-point or 3-point Calibration)
def convert_ph(voltage, calibration_data):
    """Convert pH sensor voltage using calibration points."""
    try:
        mode = calibration_data.get("mode", "2-point")
        cal_points = calibration_data.get("calibration_points", {})

        if mode not in cal_points:
            return None

        cal_set = cal_points.get(mode, {})

        ph4_voltage = cal_set.get("ph4_voltage")
        ph7_voltage = cal_set.get("ph7_voltage")
        ph10_voltage = cal_set.get("ph10_voltage") if mode == "3-point" else None

        if ph4_voltage is None or ph7_voltage is None or (mode == "3-point" and ph10_voltage is None):
            return None

        # ✅ Perform calibration conversion
        if mode == "3-point" and ph10_voltage is not None:
            if voltage >= ph7_voltage:
                slope = (10.0 - 7.0) / (ph10_voltage - ph7_voltage)
                ph_value = slope * (voltage - ph7_voltage) + 7.0
            else:
                slope = (7.0 - 4.0) / (ph7_voltage - ph4_voltage)
                ph_value = slope * (voltage - ph7_voltage) + 7.0
        else:
            slope = (7.0 - 4.0) / (ph7_voltage - ph4_voltage)
            ph_value = slope * (voltage - ph7_voltage) + 7.0

        return round(ph_value, 3)

    except Exception as e:
        print(f"\n❌ ERROR: pH conversion failed: {e}")
        return None

# ✅ Initialize I2C for ADS1115 (pH Sensor)
i2c = busio.I2C(board.SCL, board.SDA)
ads = ADS1115(i2c)

# ✅ Live pH Reading Loop
def monitor_ph():
    """Continuously reads and updates pH sensor voltage and converted pH value."""
    calibration_data = load_calibration()
    
    try:
        while True:
            # ✅ Read pH Sensor Voltage from ADS1115 A0
            ph_voltage = AnalogIn(ads, 0).voltage

            # ✅ Convert to pH using calibration
            ph_value = convert_ph(ph_voltage, calibration_data)

            # ✅ Display updated values in place (No new lines)
            sys.stdout.write(f"\r📡 pH Voltage: {ph_voltage:.3f}V | pH Value: {ph_value if ph_value is not None else '⚠ ERROR'}     ")
            sys.stdout.flush()

            time.sleep(1)  # ✅ Update every second

    except KeyboardInterrupt:
        print("\n🔴 Stopping pH Monitor.")

# ✅ Run the pH monitor
monitor_ph()

