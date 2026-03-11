import asyncio
import logging
import time
from datetime import datetime
import pytz
from settings import load_settings, save_settings

logger = logging.getLogger(__name__)
from sensors import read_all_sensors, read_ph_sensor
from pumps import activate_pump
from ph_buffer import add_reading, get_average, get_last_n_average, clear_buffer, buffer_size, latest_age_seconds
from database import log_sensor_data
from datetime import datetime, timedelta


# ✅ Set timezone to Central Standard Time (CST)
CST = pytz.timezone("America/Chicago")

_last_dev_mode = None


def _handle_dev_mode_transition(settings):
    """Clear the rolling pH buffer when switching from dev_mode ON to OFF."""
    global _last_dev_mode
    current = bool(settings.get("dev_mode", False))
    if _last_dev_mode is True and current is False:
        # We just left dev mode; drop simulated readings from the buffer
        clear_buffer()
    _last_dev_mode = current


async def continuous_monitoring():
    """Continuously reads sensors based on the interval in settings.json and sends data to InfluxDB at the specified interval."""
    last_db_update = time.time()

    while True:
        # Reload settings every iteration (captures dev_mode and interval changes)
        settings = load_settings()
        _handle_dev_mode_transition(settings)
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
        _handle_dev_mode_transition(settings)
        if not settings.get("pH_monitoring_enabled", False):
            # When auto pH monitoring is toggled from OFF to ON in the UI,
            # we want the next loop iteration (and thus the first averaged
            # pH check and any pump action) to happen quickly. Keep this
            # sleep short so enabling monitoring triggers a check almost
            # immediately.
            await asyncio.sleep(1)
            continue

        sensor_intervals = settings.get("sensor_intervals") or {}
        ph_check_interval = sensor_intervals.get("ph_check_interval", 60)
        ph_min_samples = sensor_intervals.get("ph_min_samples", 10)
        sensor_update_interval = sensor_intervals.get("sensor_update_interval", 60)
        try:
            ph_min_samples = int(ph_min_samples)
        except (TypeError, ValueError):
            ph_min_samples = 10
        if ph_min_samples < 1:
            ph_min_samples = 1
        try:
            sensor_update_interval = int(sensor_update_interval)
        except (TypeError, ValueError):
            sensor_update_interval = 60

        # Be defensive: pump_settings might be missing or malformed in settings.json
        pump_settings = settings.get("pump_settings") or {}
        if not isinstance(pump_settings, dict):
            pump_settings = {}

        low_pH = pump_settings.get("low_pH", 5.7)
        high_pH = pump_settings.get("high_pH", 6.3)
        pump_duration = pump_settings.get("pump_duration", 5)
        stabilization_time = pump_settings.get("stabilization_time", 30)

        # Prefer an average of the most recent 30 continuous-cycle readings
        # so that scheduled checks are based on a stable value instead of
        # a single potentially noisy sample. The minimum number of samples
        # required can be tuned via sensor_intervals.ph_min_samples.
        avg_ph_value = get_last_n_average(count=30, min_readings=ph_min_samples)

        # Track how many buffered samples we currently have versus the target
        try:
            total_samples_in_buffer = buffer_size()
        except Exception:
            total_samples_in_buffer = 0

        # Also ensure the buffer is "fresh" — if the latest sample is too old,
        # we treat the average as unavailable so we never act on stale data.
        try:
            age_seconds = latest_age_seconds()
        except Exception:
            age_seconds = None
        max_fresh_age = max(2 * sensor_update_interval, 15 * 60)  # reuse health-check style threshold
        if age_seconds is None or age_seconds > max_fresh_age:
            avg_ph_value = None

        # If we don't have enough *fresh* samples to compute a stable average,
        # we skip any pump action for this cycle and treat it as "average or bust".
        if avg_ph_value is None:
            existing_settings = load_settings()
            samples_required = ph_min_samples
            samples_used = min(total_samples_in_buffer, samples_required)
            existing_settings["ph_samples_available"] = samples_used
            existing_settings["ph_samples_required"] = samples_required

            # Mark that a check cycle ran but couldn't compute an average yet.
            now_cst_end = datetime.now(CST)
            now_cst_end_str = now_cst_end.strftime("%Y-%m-%d %I:%M %p")
            next_check_time = now_cst_end + timedelta(seconds=ph_check_interval)
            next_check_time_str = next_check_time.strftime("%Y-%m-%d %I:%M %p")
            existing_settings["last_ph_check"] = now_cst_end_str
            existing_settings["next_ph_check"] = next_check_time_str
            try:
                existing_settings["ph_check_started_at"] = datetime.utcnow().isoformat()
            except Exception:
                existing_settings["ph_check_started_at"] = None

            await save_settings(existing_settings)
            await asyncio.sleep(ph_check_interval)
            continue

        # At this point we have a valid averaged pH value from the buffer only.
        avg_ph_voltage = settings.get("ph_voltage")  # Latest from continuous loop

        # ✅ Determine next check's required sleep duration based on pH
        if avg_ph_value < low_pH:
            await activate_pump(1, pump_duration, ph_value=avg_ph_value)
            sleep_time = stabilization_time
        elif avg_ph_value > high_pH:
            await activate_pump(2, pump_duration, ph_value=avg_ph_value)
            sleep_time = stabilization_time
        else:
            sleep_time = ph_check_interval

        # Ensure timestamps and pH history persist correctly
        existing_settings = load_settings()

        # Track last/previous pH check values and a simple trend direction
        previous_ph_check_value = existing_settings.get("last_ph_value")
        existing_settings["previous_ph_check_value"] = previous_ph_check_value
        existing_settings["last_ph_value"] = avg_ph_value

        trend = "flat"
        try:
            if isinstance(previous_ph_check_value, (int, float)) and previous_ph_check_value is not None:
                if avg_ph_value > previous_ph_check_value:
                    trend = "up"
                elif avg_ph_value < previous_ph_check_value:
                    trend = "down"
        except Exception:
            trend = "flat"
        existing_settings["ph_trend_direction"] = trend

        # Track how many buffered samples were available vs. the configured minimum
        try:
            total_samples_in_buffer = buffer_size()
        except Exception:
            total_samples_in_buffer = 0
        samples_required = ph_min_samples
        samples_used = min(total_samples_in_buffer, samples_required)
        existing_settings["ph_samples_available"] = samples_used
        existing_settings["ph_samples_required"] = samples_required

        # ✅ Get timestamp at the *end* of the check, after any pump action
        now_cst_end = datetime.now(CST)
        now_cst_end_str = now_cst_end.strftime("%Y-%m-%d %I:%M %p")

        next_check_time = now_cst_end + timedelta(seconds=sleep_time)
        next_check_time_str = next_check_time.strftime("%Y-%m-%d %I:%M %p")

        existing_settings["last_ph_check"] = now_cst_end_str
        existing_settings["next_ph_check"] = next_check_time_str

        # Mark when this check completed so the UI can briefly show an
        # \"active\" indicator for the pH monitoring loop.
        try:
            existing_settings["ph_check_started_at"] = datetime.utcnow().isoformat()
        except Exception:
            existing_settings["ph_check_started_at"] = None

        # ✅ Save updated timestamps and pH history
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
