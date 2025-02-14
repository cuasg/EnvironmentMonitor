import time
import board
import adafruit_dht

# ✅ Define the GPIO pin where the DHT22 is connected
DHT_PIN = board.D5  # Change this if needed

# ✅ Initialize the DHT sensor
dht_sensor = adafruit_dht.DHT22(DHT_PIN)

def read_dht_debug():
    """Reads the DHT22 sensor with detailed debugging."""
    print("🔍 DEBUG: Starting DHT22 Sensor Test...")

    while True:
        try:
            print("🔄 Attempting to read DHT sensor...")
            
            # ✅ Read temperature and humidity
            temperature_c = dht_sensor.temperature
            humidity = dht_sensor.humidity

            # ✅ Check if values were retrieved
            if temperature_c is not None and humidity is not None:
                temperature_f = round((temperature_c * 9/5) + 32, 2)
                humidity = round(humidity, 2)
                print(f"✅ SUCCESS: Temperature: {temperature_f}°F | Humidity: {humidity}%")
            else:
                print("⚠ WARNING: Failed to get valid readings. Retrying...")

        except RuntimeError as e:
            print(f"⚠ WARNING: DHT sensor error: {e}. Retrying...")

        except Exception as e:
            print(f"❌ ERROR: Exception occurred while reading DHT sensor: {e}")
            break  # Exit loop if a critical error occurs

        # ✅ Wait 2 seconds before retrying
        time.sleep(2)

# ✅ Run the function
read_dht_debug()
