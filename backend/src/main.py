import asyncio
import time
from datetime import datetime
import pytz
from settings import load_settings, save_settings
from sensors import read_all_sensors, average_ph_readings
from pumps import activate_pump
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
            print("⚠ Sensor read failed; keeping previous values. Retrying next interval.")

        current_time = time.time()
        if current_time - last_db_update >= sensor_update_interval:
            await log_sensor_data()
            last_db_update = current_time

        await asyncio.sleep(sensor_update_interval)







async def ph_monitoring():
    """Continuously monitors pH and activates pumps if needed."""
    print("🛠️ pH Monitoring Started...")

    while True:
        settings = load_settings()
        if not settings.get("pH_monitoring_enabled", False):
            print("⏸️ pH Monitoring Paused. Waiting for activation...")
            await asyncio.sleep(5)
            continue

        sensor_intervals = settings.get("sensor_intervals") or {}
        ph_check_interval = sensor_intervals.get("ph_check_interval", 60)
        low_pH = settings["pump_settings"].get("low_pH", 5.7)
        high_pH = settings["pump_settings"].get("high_pH", 6.3)
        pump_duration = settings["pump_settings"].get("pump_duration", 5)
        stabilization_time = settings["pump_settings"].get("stabilization_time", 30)

        print("📏 Running pH averaging function...")
        avg_ph_voltage, avg_ph_value = await average_ph_readings()

        if avg_ph_value is None:
            print("⚠ ERROR: Invalid pH value detected. Retrying in 10 seconds...")
            await asyncio.sleep(10)
            continue

        print(f"📊 Average pH: {avg_ph_value} | Voltage: {avg_ph_voltage}")

        # ✅ Get current timestamp
        now_cst = datetime.now(CST)
        now_cst_str = now_cst.strftime("%Y-%m-%d %I:%M %p")

        # ✅ Determine next check time & required sleep duration
        if avg_ph_value < low_pH:
            print(f"⚠ pH too LOW ({avg_ph_value})! Activating pH UP pump...")
            await activate_pump(1, pump_duration, ph_value=avg_ph_value)
            sleep_time = stabilization_time
        elif avg_ph_value > high_pH:
            print(f"⚠ pH too HIGH ({avg_ph_value})! Activating pH DOWN pump...")
            await activate_pump(2, pump_duration, ph_value=avg_ph_value)
            sleep_time = stabilization_time
        else:
            print(f"✅ pH is within range ({low_pH} - {high_pH}). No action needed.")
            sleep_time = ph_check_interval

        next_check_time = now_cst + timedelta(seconds=sleep_time)
        next_check_time_str = next_check_time.strftime("%Y-%m-%d %I:%M %p")

        print(f"🔍 DEBUG: [ph_monitoring] BEFORE SAVE last_ph_check = {now_cst_str}, next_ph_check = {next_check_time_str}")

        # ✅ Ensure timestamps persist correctly
        existing_settings = load_settings()
        existing_settings["last_ph_check"] = now_cst_str
        existing_settings["next_ph_check"] = next_check_time_str

        # ✅ Save updated timestamps
        await save_settings(existing_settings)

        print(f"📅 Last pH Check: {now_cst_str} | Next pH Check: {next_check_time_str}")
        print(f"⏳ Waiting for {sleep_time} seconds before next check...")

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
