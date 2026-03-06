"""
Sensor facade: dev_mode uses simulated values; otherwise delegates to sensors_hardware.
No hardware imports at top level so the app can start on Windows/WSL when dev_mode is True.
"""
import asyncio
import logging
import random
from settings import load_settings, save_settings

logger = logging.getLogger(__name__)

# Simulated value ranges (slight drift each read so UI looks live)
_SIM_PH_VOLTAGE_BASE = 2.55
_SIM_PH_VALUE_BASE = 6.0
_SIM_TDS_VOLTAGE_BASE = 0.65
_SIM_PPM_BASE = 240.0
_SIM_LIGHT_ANALOG_BASE = 1.8
_SIM_AIR_TEMP_BASE = 72.0
_SIM_HUMIDITY_BASE = 45.0
_SIM_WATER_TEMP_BASE = 71.0
_DRIFT = 0.08  # max random drift


def _simulate_ph():
    """Return (ph_voltage, pH_value) in plausible range."""
    v = _SIM_PH_VOLTAGE_BASE + random.uniform(-_DRIFT, _DRIFT)
    v = max(2.0, min(2.9, v))
    p = _SIM_PH_VALUE_BASE + random.uniform(-0.15, 0.15)
    p = max(5.8, min(6.5, round(p, 1)))
    return round(v, 3), p


def _simulate_dht():
    """Return {temperature_f, humidity}."""
    t = _SIM_AIR_TEMP_BASE + random.uniform(-2, 2)
    t = max(68, min(78, round(t, 2)))
    h = _SIM_HUMIDITY_BASE + random.uniform(-5, 5)
    h = max(35, min(55, round(h, 2)))
    return {"temperature_f": t, "humidity": h}


def _simulate_water_temp():
    """Return water temp in °F."""
    t = _SIM_WATER_TEMP_BASE + random.uniform(-2, 2)
    return round(max(68, min(76, t)), 2)


def _simulate_tds(water_temp_c):
    """Return (tds_voltage, ppm_500)."""
    v = _SIM_TDS_VOLTAGE_BASE + random.uniform(-0.05, 0.05)
    v = max(0.3, min(1.0, round(v, 3)))
    ppm = _SIM_PPM_BASE + random.uniform(-20, 20)
    ppm = max(150, min(400, round(ppm, 2)))
    return v, ppm


def _simulate_light():
    """Return {digital, analog_voltage}."""
    analog = _SIM_LIGHT_ANALOG_BASE + random.uniform(-0.3, 0.3)
    analog = max(0.0, min(3.0, round(analog, 3)))
    digital = 1 if analog > 2.5 else 0
    return {"digital": digital, "analog_voltage": analog}


async def _simulate_ph_sensor():
    """Async wrapper for simulated pH read."""
    await asyncio.sleep(0.1)
    return _simulate_ph()


async def _simulate_ph_readings_60():
    """Simulate 60 one-second pH reads then average (fast in dev: short sleeps)."""
    voltages = []
    for _ in range(60):
        settings = load_settings()
        if not settings.get("pH_monitoring_enabled", False):
            return None, None
        v, p = _simulate_ph()
        voltages.append(v)
        await asyncio.sleep(0.05)
    if len(voltages) < 10:
        return None, None
    avg_v = sum(voltages) / len(voltages)
    avg_p = _SIM_PH_VALUE_BASE + random.uniform(-0.1, 0.1)
    avg_p = max(5.8, min(6.5, round(avg_p, 1)))
    await save_settings({"ph_voltage": avg_v, "pH_value": avg_p})
    return round(avg_v, 3), avg_p


_hardware_available_cache = None  # cached: True/False after first check


def _hardware_available():
    """True if sensors_hardware can be imported (e.g. on Pi with deps installed)."""
    global _hardware_available_cache
    if _hardware_available_cache is not None:
        return _hardware_available_cache
    try:
        import sensors_hardware  # noqa: F401
        _hardware_available_cache = True
    except (ModuleNotFoundError, ImportError):
        _hardware_available_cache = False
        logger.debug("Hardware modules not available; using simulated sensors")
    return _hardware_available_cache


async def read_ph_sensor():
    settings = load_settings()
    if settings.get("dev_mode", False) or not _hardware_available():
        return await _simulate_ph_sensor()
    import sensors_hardware
    return await sensors_hardware.read_ph_sensor()


def read_dht_sensor():
    settings = load_settings()
    if settings.get("dev_mode", False) or not _hardware_available():
        return _simulate_dht()
    import sensors_hardware
    return sensors_hardware.read_dht_sensor()


async def read_ds18b20():
    settings = load_settings()
    if settings.get("dev_mode", False) or not _hardware_available():
        await asyncio.sleep(0.05)
        return _simulate_water_temp()
    import sensors_hardware
    return await sensors_hardware.read_ds18b20()


async def read_tds_sensor(water_temp_c):
    settings = load_settings()
    if settings.get("dev_mode", False) or not _hardware_available():
        await asyncio.sleep(0.05)
        return _simulate_tds(water_temp_c)
    import sensors_hardware
    return await sensors_hardware.read_tds_sensor(water_temp_c)


async def read_light_sensor():
    settings = load_settings()
    if settings.get("dev_mode", False) or not _hardware_available():
        await asyncio.sleep(0.05)
        return _simulate_light()
    import sensors_hardware
    return await sensors_hardware.read_light_sensor()


async def average_ph_readings():
    settings = load_settings()
    if settings.get("dev_mode", False) or not _hardware_available():
        return await _simulate_ph_readings_60()
    import sensors_hardware
    return await sensors_hardware.average_ph_readings()


async def read_all_sensors():
    """When dev_mode is True: use simulated values. When dev_mode is False and hardware unavailable: do not write fake data; mark sensors offline."""
    settings = load_settings()
    dev_mode = settings.get("dev_mode", False)
    hw_available = _hardware_available()

    if dev_mode:
        return await _read_all_sensors_simulated()

    if not hw_available:
        await save_settings({"sensors_available": False, "sensors_unavailable_reason": "Hardware modules not available (install Pi dependencies)."})
        return None

    import sensors_hardware
    try:
        data = await sensors_hardware.read_all_sensors()
        if data is not None:
            await save_settings({"sensors_available": True, "sensors_unavailable_reason": None})
        return data
    except Exception as e:
        print(f"❌ Sensor read failed: {e}")
        await save_settings({"sensors_available": False, "sensors_unavailable_reason": str(e)})
        return None


async def _read_all_sensors_simulated():
    """Read all sensors with simulated values and update settings."""
    try:
        settings = load_settings()
        preserved_last_ph_check = settings.get("last_ph_check", "N/A")
        preserved_next_ph_check = settings.get("next_ph_check", "N/A")
        preserved_last_pump_activation = settings.get("last_pump_activation", {"pump": None, "timestamp": "N/A"})

        ph_voltage, pH_value = _simulate_ph()
        dht_data = _simulate_dht()
        water_temperature_f = _simulate_water_temp()
        water_temp_c = (water_temperature_f - 32) * (5/9)
        tds_voltage, ppm_500 = _simulate_tds(water_temp_c)
        light_data = _simulate_light()

        updated_sensor_data = {
            "sensors_available": True,
            "ph_voltage": ph_voltage,
            "pH_value": pH_value,
            "tds_voltage": tds_voltage,
            "ppm_500": ppm_500,
            "light_sensor": light_data,
            "humidity": dht_data["humidity"],
            "air_temperature_f": dht_data["temperature_f"],
            "water_temperature_f": water_temperature_f,
        }

        if preserved_last_ph_check != "N/A":
            updated_sensor_data["last_ph_check"] = preserved_last_ph_check
        if preserved_next_ph_check != "N/A":
            updated_sensor_data["next_ph_check"] = preserved_next_ph_check
        if preserved_last_pump_activation["timestamp"] != "N/A" or preserved_last_pump_activation["pump"] is not None:
            updated_sensor_data["last_pump_activation"] = preserved_last_pump_activation

        await save_settings(updated_sensor_data)
        return updated_sensor_data

    except Exception as e:
        print(f"❌ ERROR: Failed to read sensors (simulated): {e}")
        return None


if __name__ == "__main__":
    asyncio.run(read_all_sensors())
