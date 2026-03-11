import asyncio
from datetime import datetime
from settings import load_settings, save_settings, get_display_tz
from grow_logs import log_pump_activation

PUMP_UP_PIN = 18    # pH Up Pump (GPIO 18)
PUMP_DOWN_PIN = 27  # pH Down Pump (GPIO 27)

_DISPLAY_TIME_FMT = "%Y-%m-%d %I:%M %p"

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


async def _pump_off_after(pump_number: int, duration: int, ph_value: float = None, is_manual: bool = False):
    """Background: sleep for duration, turn pump off, save settings and log. Used after pump is already ON."""
    import RPi.GPIO as GPIO
    pump_pin = PUMP_UP_PIN if pump_number == 1 else PUMP_DOWN_PIN
    pump_label = "up" if pump_number == 1 else "down"
    tz = get_display_tz()
    timestamp_local = datetime.now(tz).strftime(_DISPLAY_TIME_FMT)
    try:
        await asyncio.sleep(duration)
        GPIO.output(pump_pin, GPIO.LOW)
        off_time = datetime.now(tz).strftime(_DISPLAY_TIME_FMT)
        print(f"✅ Pump {pump_number} ({pump_label}) deactivated at {off_time}.")
        settings = load_settings()
        settings["last_pump_activation"] = {"pump": pump_label, "timestamp": timestamp_local}
        await save_settings(settings)
        if ph_value:
            log_pump_activation(pump_label, timestamp_local, ph_value, is_manual=is_manual, duration_seconds=duration)
        print(f"✅ Pump Activation Logged: {pump_label.capitalize()} pump ran at {timestamp_local}.")
    except Exception as e:
        print(f"❌ Error in pump off/save: {e}")


def start_pump_then_return(pump_number: int, duration: int, ph_value: float = None, is_manual: bool = False):
    """Turns the pump ON immediately, schedules turn-off after duration, and returns so the API can respond.
    The UI can start its countdown when it receives the response, in sync with the actual pump run."""
    if pump_number not in [1, 2]:
        print("❌ Error: Invalid pump number! Must be 1 (pH Up) or 2 (pH Down).")
        return False
    settings = load_settings()
    if ph_value is None:
        ph_value = settings.get("pH_value")
    pump_label = "up" if pump_number == 1 else "down"
    tz = get_display_tz()
    timestamp_local = datetime.now(tz).strftime(_DISPLAY_TIME_FMT)

    if settings.get("dev_mode", False):
        print(f"🔧 Pump {pump_number} ({pump_label}) activation (dev mode, simulated) for {duration}s at {timestamp_local}...")
        settings["last_pump_activation"] = {"pump": pump_label, "timestamp": timestamp_local}
        asyncio.get_running_loop().create_task(_save_dev_pump_and_log(pump_label, timestamp_local, ph_value, is_manual, duration))
        print(f"✅ Pump activation logged (simulated).")
        return True

    _ensure_gpio()
    import RPi.GPIO as GPIO
    pump_pin = PUMP_UP_PIN if pump_number == 1 else PUMP_DOWN_PIN
    print(f"⚡ Activating Pump {pump_number} ({pump_label}) for {duration} seconds at {timestamp_local}...")
    try:
        GPIO.output(pump_pin, GPIO.HIGH)
        asyncio.get_running_loop().create_task(_pump_off_after(pump_number, duration, ph_value, is_manual))
        return True
    except Exception as e:
        print(f"❌ Error activating pump {pump_number}: {e}")
        return False


async def _save_dev_pump_and_log(pump_label: str, timestamp_local: str, ph_value, is_manual: bool, duration: int):
    """Dev mode: save last_pump_activation and log (async, so API can return immediately)."""
    settings = load_settings()
    settings["last_pump_activation"] = {"pump": pump_label, "timestamp": timestamp_local}
    await save_settings(settings)
    if ph_value:
        log_pump_activation(pump_label, timestamp_local, ph_value, is_manual=is_manual, duration_seconds=duration)


async def activate_pump(pump_number: int, duration: int, ph_value: float = None, is_manual: bool = False):
    """Activates the specified pump (1 = pH Up, 2 = pH Down) for a set duration and logs the event in CST.
    Used by main.py pH loop; for manual API use start_pump_then_return so the API can respond immediately."""
    if pump_number not in [1, 2]:
        print("❌ Error: Invalid pump number! Must be 1 (pH Up) or 2 (pH Down).")
        return False

    settings = load_settings()
    if ph_value is None:
        ph_value = settings.get("pH_value")

    if settings.get("dev_mode", False):
        pump_label = "up" if pump_number == 1 else "down"
        tz = get_display_tz()
        timestamp_local = datetime.now(tz).strftime(_DISPLAY_TIME_FMT)
        print(f"🔧 Pump {pump_number} ({pump_label}) activation (dev mode, simulated) for {duration}s at {timestamp_local}...")
        settings["last_pump_activation"] = {
            "pump": pump_label,
            "timestamp": timestamp_local
        }
        await save_settings(settings)
        if ph_value:
            log_pump_activation(pump_label, timestamp_local, ph_value, is_manual=is_manual, duration_seconds=duration)
        print(f"✅ Pump activation logged (simulated).")
        return True

    _ensure_gpio()
    import RPi.GPIO as GPIO
    pump_pin = PUMP_UP_PIN if pump_number == 1 else PUMP_DOWN_PIN
    pump_label = "up" if pump_number == 1 else "down"
    tz = get_display_tz()
    timestamp_local = datetime.now(tz).strftime(_DISPLAY_TIME_FMT)
    print(f"⚡ Activating Pump {pump_number} ({pump_label}) for {duration} seconds at {timestamp_local}...")
    try:
        GPIO.output(pump_pin, GPIO.HIGH)
        await asyncio.sleep(duration)
        GPIO.output(pump_pin, GPIO.LOW)
        print(f"✅ Pump {pump_number} ({pump_label}) deactivated at {timestamp_local}.")
        settings = load_settings()
        settings["last_pump_activation"] = {"pump": pump_label, "timestamp": timestamp_local}
        await save_settings(settings)
        if ph_value:
            log_pump_activation(pump_label, timestamp_local, ph_value, is_manual=is_manual, duration_seconds=duration)
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
