import asyncio
from datetime import datetime
import pytz
from settings import load_settings, save_settings
from grow_logs import log_pump_activation

PUMP_UP_PIN = 18    # pH Up Pump (GPIO 18)
PUMP_DOWN_PIN = 27  # pH Down Pump (GPIO 27)
CST = pytz.timezone("America/Chicago")

_gpio_initialized = False


def _ensure_gpio():
    """Lazy init GPIO; only called when dev_mode is False."""
    global _gpio_initialized
    if _gpio_initialized:
        return
    import RPi.GPIO as GPIO
    GPIO.setwarnings(False)
    GPIO.cleanup()
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(PUMP_UP_PIN, GPIO.OUT, initial=GPIO.LOW)
    GPIO.setup(PUMP_DOWN_PIN, GPIO.OUT, initial=GPIO.LOW)
    _gpio_initialized = True


async def activate_pump(pump_number: int, duration: int, ph_value: float = None, is_manual: bool = False):
    """Activates the specified pump (1 = pH Up, 2 = pH Down) for a set duration and logs the event in CST.
    
    Args:
        pump_number: 1 for pH Up, 2 for pH Down
        duration: Duration in seconds
        ph_value: Optional pH value to log (if not provided, will try to get from settings)
        is_manual: Whether this is a manual activation (default: False)
    """

    if pump_number not in [1, 2]:
        print("❌ Error: Invalid pump number! Must be 1 (pH Up) or 2 (pH Down).")
        return False

    settings = load_settings()
    
    # Get pH value if not provided
    if ph_value is None:
        ph_value = settings.get("pH_value")

    if settings.get("dev_mode", False):
        pump_label = "up" if pump_number == 1 else "down"
        timestamp_cst = datetime.now(CST).strftime("%Y-%m-%d %H:%M:%S")
        print(f"🔧 Pump {pump_number} ({pump_label}) activation (dev mode, simulated) for {duration}s at {timestamp_cst} CST...")
        settings["last_pump_activation"] = {
            "pump": pump_label,
            "timestamp": timestamp_cst
        }
        await save_settings(settings)
        
        # Log to grow log if primary grow exists
        if ph_value:
            log_pump_activation(pump_label, timestamp_cst, ph_value, is_manual=is_manual, duration_seconds=duration)
        
        print(f"✅ Pump activation logged (simulated).")
        return True

    _ensure_gpio()
    import RPi.GPIO as GPIO

    pump_pin = PUMP_UP_PIN if pump_number == 1 else PUMP_DOWN_PIN
    pump_label = "up" if pump_number == 1 else "down"
    timestamp_cst = datetime.now(CST).strftime("%Y-%m-%d %H:%M:%S")

    print(f"⚡ Activating Pump {pump_number} ({pump_label}) for {duration} seconds at {timestamp_cst} CST...")

    try:
        GPIO.output(pump_pin, GPIO.HIGH)
        await asyncio.sleep(duration)
        GPIO.output(pump_pin, GPIO.LOW)

        print(f"✅ Pump {pump_number} ({pump_label}) deactivated at {timestamp_cst} CST.")

        settings["last_pump_activation"] = {
            "pump": pump_label,
            "timestamp": timestamp_cst
        }
        await save_settings(settings)
        
        # Log to grow log if primary grow exists
        if ph_value:
            log_pump_activation(pump_label, timestamp_cst, ph_value, is_manual=is_manual, duration_seconds=duration)
        
        print(f"✅ Pump Activation Logged: {pump_label.capitalize()} pump ran at {timestamp_cst} CST.")
        return True

    except Exception as e:
        print(f"❌ Error activating pump {pump_number}: {e}")
        return False


async def test_pumps():
    """Test both pumps by running them for 2 seconds each."""
    await activate_pump(1, 2)
    await asyncio.sleep(1)
    await activate_pump(2, 2)


if __name__ == "__main__":
    try:
        asyncio.run(test_pumps())
    except KeyboardInterrupt:
        print("\n⏹️ Stopping pump test...")
    finally:
        if _gpio_initialized:
            import RPi.GPIO as GPIO
            GPIO.cleanup()
            print("🔄 GPIO cleaned up.")
