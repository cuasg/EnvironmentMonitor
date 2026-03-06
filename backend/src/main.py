import asyncio
import logging
import time
from datetime import datetime
import pytz
from settings import load_settings, save_settings

logger = logging.getLogger(__name__)
from sensors import read_all_sensors, read_ph_sensor
from pumps import activate_pump
from ph_buffer import add_reading, get_average
from database import log_sensor_data
from datetime import datetime, timedelta


# ✅ Set timezone to Central Standard Time (CST)
CST = pytz.timezone("America/Chicago")


async def continuous_monitoring():
    """Continuously reads sensors based on the interval in settings.json and sends data to InfluxDB at the specified interval."""
    last_db_update = time.time()

    while True:
        # Reload settings every iteration (captures dev_mode and interval changes)
        settings = load_settings()
        sensor_intervals = settings.get("sensor_intervals") or {}
        sensor_update_interval = sensor_intervals.get("sensor_update_interval", 60)

        updated_sensor_data = await read_all_sensors()
        if updated_sensor_data is None:
            logger.debug("Sensor read failed; retrying next interval")
        elif updated_sensor_data.get("pH_value") is not None:
            add_reading(updated_sensor_data["pH_value"])

        current_time = time.time()
        if current_time - last_db_update >= sensor_update_interval:
            await log_sensor_data()
            last_db_update = current_time

        await asyncio.sleep(sensor_update_interval)







async def ph_monitoring():
    """Continuously monitors pH and activates pumps if needed."""
    while True:
        settings = load_settings()
        if not settings.get("pH_monitoring_enabled", False):
            await asyncio.sleep(5)
            continue

        sensor_intervals = settings.get("sensor_intervals") or {}
        ph_check_interval = sensor_intervals.get("ph_check_interval", 60)
        ph_window_minutes = sensor_intervals.get("ph_average_window_minutes", 5)
        low_pH = settings["pump_settings"].get("low_pH", 5.7)
        high_pH = settings["pump_settings"].get("high_pH", 6.3)
        pump_duration = settings["pump_settings"].get("pump_duration", 5)
        stabilization_time = settings["pump_settings"].get("stabilization_time", 30)

        avg_ph_value = get_average(minutes=ph_window_minutes, min_readings=6)
        if avg_ph_value is None:
            avg_ph_voltage, avg_ph_value = await read_ph_sensor()
        else:
            avg_ph_voltage = settings.get("ph_voltage")  # Latest from continuous loop

        if avg_ph_value is None:
            await asyncio.sleep(10)
            continue

        # ✅ Get current timestamp
        now_cst = datetime.now(CST)
        now_cst_str = now_cst.strftime("%Y-%m-%d %I:%M %p")

        # ✅ Determine next check time & required sleep duration
        if avg_ph_value < low_pH:
            await activate_pump(1, pump_duration, ph_value=avg_ph_value)
            sleep_time = stabilization_time
        elif avg_ph_value > high_pH:
            await activate_pump(2, pump_duration, ph_value=avg_ph_value)
            sleep_time = stabilization_time
        else:
            sleep_time = ph_check_interval

        next_check_time = now_cst + timedelta(seconds=sleep_time)
        next_check_time_str = next_check_time.strftime("%Y-%m-%d %I:%M %p")

        # Ensure timestamps persist correctly
        existing_settings = load_settings()
        existing_settings["last_ph_check"] = now_cst_str
        existing_settings["next_ph_check"] = next_check_time_str

        # ✅ Save updated timestamps
        await save_settings(existing_settings)
        await asyncio.sleep(sleep_time)







async def main():
    """Starts continuous monitoring and pH regulation loops."""
    await asyncio.gather(
        continuous_monitoring(),
        ph_monitoring()
    )


# ✅ Run the monitoring loop when script starts
if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n⏹️ Stopping monitoring...")
