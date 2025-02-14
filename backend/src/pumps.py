import asyncio
import RPi.GPIO as GPIO
import time
import json
import os
from datetime import datetime
import pytz
from settings import load_settings, save_settings

# Define pump GPIO pins
PUMP_UP_PIN = 18    # pH Up Pump (GPIO 18)
PUMP_DOWN_PIN = 27  # pH Down Pump (GPIO 27)

# Setup GPIO mode
GPIO.setmode(GPIO.BCM)
GPIO.setup(PUMP_UP_PIN, GPIO.OUT, initial=GPIO.LOW)
GPIO.setup(PUMP_DOWN_PIN, GPIO.OUT, initial=GPIO.LOW)

# Set timezone to Central Standard Time (CST)
CST = pytz.timezone("America/Chicago")


async def activate_pump(pump_number: int, duration: int):
    """Activates the specified pump (1 = pH Up, 2 = pH Down) for a set duration and logs the event in CST."""

    # Validate pump number
    if pump_number not in [1, 2]:
        print("❌ Error: Invalid pump number! Must be 1 (pH Up) or 2 (pH Down).")
        return False

    # Load settings
    settings = load_settings()

    # Determine pump pin and label
    pump_pin = PUMP_UP_PIN if pump_number == 1 else PUMP_DOWN_PIN
    pump_label = "up" if pump_number == 1 else "down"

    # Get current timestamp in CST
    timestamp_cst = datetime.now(CST).strftime("%Y-%m-%d %H:%M:%S")

    print(f"⚡ Activating Pump {pump_number} ({pump_label}) for {duration} seconds at {timestamp_cst} CST...")

    try:
        # ✅ Turn on pump
        GPIO.output(pump_pin, GPIO.HIGH)
        await asyncio.sleep(duration)
        GPIO.output(pump_pin, GPIO.LOW)

        print(f"✅ Pump {pump_number} ({pump_label}) deactivated at {timestamp_cst} CST.")

        # ✅ Update settings with last pump activation in CST
        settings["last_pump_activation"] = {
            "pump": pump_label,
            "timestamp": timestamp_cst  # Store in CST
        }

        # ✅ Save settings persistently
        await save_settings(settings)

        print(f"✅ Pump Activation Logged: {pump_label.capitalize()} pump ran at {timestamp_cst} CST.")

        return True

    except Exception as e:
        print(f"❌ Error activating pump {pump_number}: {e}")
        return False


async def test_pumps():
    """Test both pumps by running them for 2 seconds each."""
    await activate_pump(1, 2)  # Test pH Up Pump
    await asyncio.sleep(1)
    await activate_pump(2, 2)  # Test pH Down Pump


# ✅ Run test when script is executed directly
if __name__ == "__main__":
    try:
        asyncio.run(test_pumps())
    except KeyboardInterrupt:
        print("\n⏹️ Stopping pump test...")
    finally:
        GPIO.cleanup()  # ✅ Ensure GPIO is cleaned up on exit
        print("🔄 GPIO cleaned up.")
