import asyncio
import csv
import io
import json
import os
import subprocess
from quart import Quart, websocket, request, jsonify
from quart_cors import cors
from settings import load_settings, save_settings
from pumps import activate_pump
from main import main  # ✅ Import the continuous monitoring loop
from oled_display import async_display_oled  # ✅ Import OLED function
from database import query_trends, TRENDS_AVAILABLE_FIELDS, check_influx_connection, get_influx_connection_status
from oled_renderer import get_current_display_state
from config import CORS_ALLOW_ORIGIN_LIST, API_HOST, API_PORT
from datetime import datetime
from grow_logs import load_grow_logs, save_grow_logs, get_primary_grow, get_grow, get_entry, export_grows_to_csv_rows
from pin_auth import (
    is_pin_configured,
    setup_pin,
    verify_pin,
    change_pin,
    create_session,
    get_session,
    require_session,
)

app = Quart(__name__)

PIN_SESSION_HEADER = "X-PIN-Session"


def error_response(message, status_code=400):
    """Return a consistent JSON error response."""
    return jsonify({"error": message}), status_code


def require_pin_session():
    """
    If PIN is configured, require a valid session for this request.
    Returns None if OK (no PIN or valid session), else (response, status_code) to return.
    """
    if not is_pin_configured():
        return None
    ok, err = require_session(lambda: request.headers.get(PIN_SESSION_HEADER))
    return None if ok else err


# CORS: list of origins + Tailscale regex (quart_cors expects list/Pattern, not callable)
app = cors(app, allow_origin=CORS_ALLOW_ORIGIN_LIST)

# ✅ WebSocket Clients List (Changed to a List Instead of a Set)
connected_clients = []

# ✅ Function to Convert datetime to String (Fix JSON Errors)
def serialize_datetime(obj):
    """Convert datetime objects to string format for JSON serialization."""
    if isinstance(obj, datetime):
        return obj.strftime("%Y-%m-%d %I:%M:%S %p")  # ✅ Converts to 12-hour format with AM/PM
    raise TypeError(f"Type {type(obj)} not serializable")

# ✅ Function to Start Background Services
async def start_services():
    print("🔍 Checking InfluxDB connection...")
    success, error = check_influx_connection()
    if success:
        print("✅ InfluxDB connection verified.")
    else:
        print(f"⚠️ InfluxDB connection check failed: {error}")
    
    print("🚀 Starting Main Monitoring Loop...")
    asyncio.create_task(main())  # ✅ Runs monitoring in the background

    print("🖥️ Starting OLED Display Loop...")
    asyncio.create_task(async_display_oled())  # ✅ Runs OLED updates in the background

    print("📡 Starting WebSocket Broadcast...")
    asyncio.create_task(websocket_broadcast_loop())  # ✅ Push settings updates

# ✅ WebSocket Route for Live Settings Updates
@app.websocket("/ws/settings")
async def settings_ws():
    """Handles WebSocket connections and keeps them alive."""
    global connected_clients
    connected_clients.append(websocket)  # ✅ Append WebSocket to list instead of set
    print(f"🔗 WebSocket Client Connected: {websocket}")

    try:
        while True:
            settings = load_settings()

            # ✅ Convert datetime fields to string safely
            datetime_keys = ["last_ph_check", "next_ph_check"]

            for key in datetime_keys:
                if key in settings and isinstance(settings[key], datetime):
                    settings[key] = settings[key].strftime("%Y-%m-%d %I:%M:%S %p")  # ✅ 12-hour format

            # ✅ Handle last_pump_activation dictionary safely
            if "last_pump_activation" in settings and isinstance(settings["last_pump_activation"], dict):
                if "timestamp" in settings["last_pump_activation"] and isinstance(settings["last_pump_activation"]["timestamp"], datetime):
                    settings["last_pump_activation"]["timestamp"] = settings["last_pump_activation"]["timestamp"].strftime("%Y-%m-%d %I:%M:%S %p")

            # ✅ Ensure settings are always JSON serializable
            json_settings = json.dumps(settings, default=serialize_datetime)

            # ✅ Send updated settings to WebSocket clients
            await websocket.send(json_settings)

            # ✅ Send a keep-alive message to prevent WebSocket disconnections
            await websocket.send(json.dumps({"message": "ping"}))

            await asyncio.sleep(5)  # ✅ Send updates every 5 seconds

    except Exception as e:
        print(f"⚠ WebSocket Error: {e}")

    finally:
        if websocket in connected_clients:
            connected_clients.remove(websocket)  # ✅ Properly remove disconnected clients
        print("❌ WebSocket Client Disconnected")

# ✅ Function to Broadcast Updates to WebSocket Clients every 5 seconds
async def websocket_broadcast_loop():
    while True:
        settings = load_settings()
        json_settings = json.dumps(settings, default=serialize_datetime)

        for client in connected_clients[:]:  # ✅ Iterate over a copy of the list
            try:
                await client.send(json_settings)
                print(f"📡 WebSocket Broadcast Sent: {json_settings}")
            except:
                print("⚠ Removing Disconnected WebSocket Client")
                connected_clients.remove(client)  # ✅ Safely remove disconnected clients

        await asyncio.sleep(5)  # ✅ Push updates every 5 seconds

# ✅ REST API to Fetch Settings (strip pin_auth for security)
@app.route("/settings", methods=["GET"])
async def get_settings():
    settings = load_settings()
    if "pin_auth" in settings:
        settings = {k: v for k, v in settings.items() if k != "pin_auth"}
    settings["pinConfigured"] = is_pin_configured()
    return jsonify(settings)


# ✅ PIN Auth Endpoints
@app.route("/auth/status", methods=["GET"])
async def auth_status():
    """Return pinConfigured and, if valid session token sent, authenticated + expiresAt."""
    token = request.headers.get(PIN_SESSION_HEADER)
    session = get_session(token) if token else None
    result = {"pinConfigured": is_pin_configured(), "authenticated": session is not None}
    if session:
        result["expiresAt"] = session["expires_at"].strftime("%Y-%m-%dT%H:%M:%SZ")
    return jsonify(result)


@app.route("/auth/setup", methods=["POST"])
async def auth_setup():
    """First-time PIN setup. Body: { "pin": "1234" }. Only allowed when PIN not configured."""
    if is_pin_configured():
        return jsonify({"error": "PIN already configured"}), 400
    data = await request.get_json() or {}
    pin = (data.get("pin") or "").strip()
    if len(pin) != 4 or not pin.isdigit():
        return jsonify({"error": "PIN must be 4 digits"}), 400
    if not setup_pin(pin):
        return jsonify({"error": "Failed to set PIN"}), 500
    token, expires_at = create_session()
    return jsonify({
        "token": token,
        "expiresAt": expires_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }), 201


@app.route("/auth/verify", methods=["POST"])
async def auth_verify():
    """Verify PIN and start session. Body: { "pin": "1234" }."""
    if not is_pin_configured():
        return jsonify({"error": "PIN not configured"}), 400
    data = await request.get_json() or {}
    pin = (data.get("pin") or "").strip()
    if len(pin) != 4 or not pin.isdigit():
        return jsonify({"error": "Invalid PIN format"}), 400
    if not verify_pin(pin):
        return jsonify({"error": "Wrong PIN"}), 401
    token, expires_at = create_session()
    return jsonify({
        "token": token,
        "expiresAt": expires_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
    })


@app.route("/auth/change-pin", methods=["POST"])
async def auth_change_pin():
    """Change PIN. Requires valid session. Body: { "currentPin": "1234", "newPin": "5678" }."""
    err = require_pin_session()
    if err is not None:
        return err[0], err[1]
    data = await request.get_json() or {}
    current = (data.get("currentPin") or "").strip()
    new_pin = (data.get("newPin") or "").strip()
    if len(current) != 4 or not current.isdigit() or len(new_pin) != 4 or not new_pin.isdigit():
        return jsonify({"error": "PINs must be 4 digits"}), 400
    if not change_pin(current, new_pin):
        return jsonify({"error": "Wrong current PIN or invalid new PIN"}), 400
    return jsonify({"message": "PIN changed successfully"})


# ✅ REST API for Trends (InfluxDB time-series)
RANGE_MINUTES = {"3h": 180, "6h": 360, "12h": 720, "24h": 1440, "72h": 4320, "7d": 10080}


@app.route("/trends", methods=["GET"])
async def get_trends():
    """Query InfluxDB for sensor trends. Params: range=3h|6h|12h|24h|72h|7d, sensors=pH_value,ppm_500,..."""
    range_param = request.args.get("range", "24h")
    sensors_param = request.args.get("sensors", "")
    range_minutes = RANGE_MINUTES.get(range_param, 1440)
    fields = [s.strip() for s in sensors_param.split(",") if s.strip()]
    data = await asyncio.to_thread(query_trends, range_minutes, fields)
    return jsonify({"data": data, "sensors": TRENDS_AVAILABLE_FIELDS})


@app.route("/oled/config", methods=["GET"])
async def get_oled_config():
    """Get OLED page configuration."""
    settings = load_settings()
    oled_config = settings.get("oled_config", {})
    # Ensure we return at least an empty pages array if config is missing
    if not oled_config or "pages" not in oled_config:
        oled_config = {"pages": []}
    return jsonify(oled_config)


@app.route("/oled/config", methods=["POST"])
async def update_oled_config():
    """Update OLED page configuration."""
    data = await request.get_json()
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid data format"}), 400
    
    await save_settings({"oled_config": data})
    return jsonify({"message": "OLED config updated successfully!"})


@app.route("/oled/display", methods=["GET"])
async def get_oled_display():
    """Get current OLED display state for mirroring."""
    state = get_current_display_state()
    # Ensure we always return a valid structure
    if not state:
        state = {
            "page_id": None,
            "page_title": "",
            "lines": [],
            "pixel_data": None,
        }
    return jsonify(state)


@app.route("/influx/status", methods=["GET"])
async def get_influx_status():
    """Get InfluxDB connection status."""
    return jsonify(get_influx_connection_status())


@app.route("/health", methods=["GET"])
async def get_health():
    """Health checks for status page: API, Influx, sensors recent, settings file, grow logs file. No auth required."""
    result = {"api": "ok"}

    # Influx
    try:
        status = get_influx_connection_status()
        result["influx"] = {"ok": status.get("connected", False), "error": status.get("error")}
    except Exception as e:
        result["influx"] = {"ok": False, "error": str(e)}

    # Sensors recent (last_ph_check present and not too old)
    result["sensors_recent"] = {"ok": True, "last_ph_check": None, "details": None}
    try:
        settings = load_settings()
        last_ph = settings.get("last_ph_check")
        result["sensors_recent"]["last_ph_check"] = last_ph
        if not last_ph or last_ph == "N/A":
            result["sensors_recent"]["ok"] = False
            result["sensors_recent"]["details"] = "No recent pH check recorded"
        else:
            try:
                # Parse "2026-02-19 1:00 PM" or similar
                dt = datetime.strptime(last_ph, "%Y-%m-%d %I:%M %p")
                interval_sec = (settings.get("sensor_intervals") or {}).get("ph_check_interval", 60)
                max_age_sec = max(2 * interval_sec, 15 * 60)  # at least 15 min
                if (datetime.now() - dt).total_seconds() > max_age_sec:
                    result["sensors_recent"]["ok"] = False
                    result["sensors_recent"]["details"] = "Last pH check is older than expected"
            except (ValueError, TypeError):
                pass  # keep ok True if we can't parse
    except Exception as e:
        result["sensors_recent"] = {"ok": False, "last_ph_check": None, "details": str(e)}

    # Settings file
    try:
        load_settings()
        result["settings_file"] = {"ok": True, "error": None}
    except Exception as e:
        result["settings_file"] = {"ok": False, "error": str(e)}

    # Grow logs file
    try:
        load_grow_logs()
        result["grow_logs_file"] = {"ok": True, "error": None}
    except Exception as e:
        result["grow_logs_file"] = {"ok": False, "error": str(e)}

    return jsonify(result)


@app.route("/influx/config", methods=["GET"])
async def get_influx_config():
    """Get InfluxDB config for UI (token masked). Uses settings.influx_config with env fallback."""
    from config import INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET
    settings = load_settings()
    ic = settings.get("influx_config") or {}
    url = (ic.get("url") or "").strip() or INFLUX_URL
    token = (ic.get("token") or "").strip() or INFLUX_TOKEN
    org = (ic.get("org") or "").strip() or INFLUX_ORG
    bucket = (ic.get("bucket") or "").strip() or INFLUX_BUCKET
    token_masked = ("***" + token[-4:]) if (token and len(token) >= 4) else ("***" if token else "")
    return jsonify({
        "url": url,
        "org": org,
        "bucket": bucket,
        "tokenMasked": token_masked,
        "configured": bool(url and token),
    })


@app.route("/influx/config", methods=["POST"])
async def save_influx_config():
    """Save InfluxDB config (PIN required when PIN is configured)."""
    err = require_pin_session()
    if err is not None:
        return err[0], err[1]
    data = await request.get_json()
    if not isinstance(data, dict):
        return error_response("Invalid data format", 400)
    settings = load_settings()
    ic = dict(settings.get("influx_config") or {})
    if "url" in data and data["url"] is not None:
        ic["url"] = str(data["url"]).strip()
    if "token" in data and data["token"] is not None and str(data["token"]).strip():
        ic["token"] = str(data["token"]).strip()
    if "org" in data and data["org"] is not None:
        ic["org"] = str(data["org"]).strip() or "HomeSensors"
    if "bucket" in data and data["bucket"] is not None:
        ic["bucket"] = str(data["bucket"]).strip() or "plantMonitor"
    await save_settings({"influx_config": ic})
    # Invalidate Influx client so next use picks up new config
    from database import invalidate_influx_client
    invalidate_influx_client()
    return jsonify({"message": "InfluxDB config saved."})


# ✅ Grow Logs API Endpoints
@app.route("/grow-logs", methods=["GET"])
async def get_grow_logs():
    """Get all grow logs."""
    return jsonify(load_grow_logs())


@app.route("/grow-logs", methods=["POST"])
async def create_grow():
    """Create a new grow."""
    data = await request.get_json()
    if not isinstance(data, dict):
        return error_response("Invalid data format", 400)
    
    logs = load_grow_logs()
    grow_id = f"grow_{datetime.now().timestamp()}"
    
    # If this is set as primary, unset other primary grows
    if data.get("is_primary", False):
        for grow in logs.get("grows", []):
            grow["is_primary"] = False
    
    grow_start = data.get("start_date", datetime.now().strftime("%Y-%m-%d"))
    raw_strains = data.get("strains")
    if isinstance(raw_strains, list) and len(raw_strains) > 0:
        strains = []
        for s in raw_strains:
            if not isinstance(s, dict):
                continue
            name = (s.get("name") or "").strip()
            if not name:
                continue
            start = (s.get("start_date") or grow_start or "").strip() or grow_start
            days = s.get("days_to_finish")
            days = int(days) if days not in (None, "", "") and str(days).strip() else None
            actual = (s.get("actual_harvest_date") or "").strip() or None
            st = s.get("strain_type") if s.get("strain_type") in ("Indica", "Sativa", "Hybrid") else "Hybrid"
            pt = s.get("plant_type") if s.get("plant_type") in ("Auto", "Photo") else "Photo"
            strains.append({"name": name, "start_date": start, "days_to_finish": days, "actual_harvest_date": actual, "strain_type": st, "plant_type": pt})
    else:
        legacy = (data.get("strain") or "").strip()
        strains = [{"name": legacy, "start_date": grow_start, "days_to_finish": None, "actual_harvest_date": None, "strain_type": data.get("strain_type", "Hybrid"), "plant_type": data.get("plant_type", "Photo")}] if legacy else []

    new_grow = {
        "id": grow_id,
        "start_date": grow_start,
        "strains": strains,
        "is_primary": data.get("is_primary", False),
        "notes": data.get("notes", ""),
        "entries": [],
    }
    
    logs.setdefault("grows", []).append(new_grow)
    
    if save_grow_logs(logs):
        return jsonify(new_grow), 201
    return error_response("Failed to save grow log", 500)


@app.route("/grow-logs/<grow_id>", methods=["PUT"])
async def update_grow(grow_id):
    """Update an existing grow."""
    data = await request.get_json()
    if not isinstance(data, dict):
        return error_response("Invalid data format", 400)
    
    logs = load_grow_logs()
    grow = get_grow(logs, grow_id)
    if not grow:
        return error_response("Grow not found", 404)
    
    if data.get("is_primary", False):
        for g in logs.get("grows", []):
            if g.get("id") != grow_id:
                g["is_primary"] = False
    
    for key in ["start_date", "is_primary", "notes"]:
        if key in data:
            grow[key] = data[key]
    if "strains" in data and isinstance(data["strains"], list):
        grow_start = grow.get("start_date", "")
        normalized = []
        for s in data["strains"]:
            if not isinstance(s, dict):
                continue
            name = (s.get("name") or "").strip()
            if not name:
                continue
            start = (s.get("start_date") or grow_start or "").strip() or grow_start
            days = s.get("days_to_finish")
            days = int(days) if days not in (None, "", "") and str(days).strip() else None
            actual = (s.get("actual_harvest_date") or "").strip() or None
            st = s.get("strain_type") if s.get("strain_type") in ("Indica", "Sativa", "Hybrid") else "Hybrid"
            pt = s.get("plant_type") if s.get("plant_type") in ("Auto", "Photo") else "Photo"
            normalized.append({"name": name, "start_date": start, "days_to_finish": days, "actual_harvest_date": actual, "strain_type": st, "plant_type": pt})
        grow["strains"] = normalized
    
    if save_grow_logs(logs):
        return jsonify({"message": "Grow updated successfully"})
    return error_response("Failed to save grow log", 500)


@app.route("/grow-logs/<grow_id>", methods=["DELETE"])
async def delete_grow(grow_id):
    """Delete a grow."""
    logs = load_grow_logs()
    logs["grows"] = [g for g in logs.get("grows", []) if g.get("id") != grow_id]
    if save_grow_logs(logs):
        return jsonify({"message": "Grow deleted successfully"})
    return error_response("Failed to save grow log", 500)


@app.route("/grow-logs/<grow_id>/entries", methods=["POST"])
async def add_grow_entry(grow_id):
    """Add an entry to a grow."""
    data = await request.get_json()
    if not isinstance(data, dict):
        return error_response("Invalid data format", 400)
    
    logs = load_grow_logs()
    grow = get_grow(logs, grow_id)
    if not grow:
        return error_response("Grow not found", 404)
    
    if "entries" not in grow:
        grow["entries"] = []
    entry_id = f"entry_{datetime.now().timestamp()}"
    entry = {
        "id": entry_id,
        "type": data.get("type"),
        "timestamp": data.get("timestamp", datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        **{k: v for k, v in data.items() if k not in ["type", "timestamp"]}
    }
    grow["entries"].append(entry)
    if save_grow_logs(logs):
        return jsonify(entry), 201
    return error_response("Failed to save entry", 500)


@app.route("/grow-logs/<grow_id>/entries/<entry_id>", methods=["PUT"])
async def update_grow_entry(grow_id, entry_id):
    """Update an entry in a grow."""
    data = await request.get_json()
    if not isinstance(data, dict):
        return error_response("Invalid data format", 400)
    
    logs = load_grow_logs()
    grow = get_grow(logs, grow_id)
    entry = get_entry(grow, entry_id) if grow else None
    if not grow or not entry:
        return error_response("Entry not found", 404)
    for key, value in data.items():
        if key != "id":
            entry[key] = value
    if save_grow_logs(logs):
        return jsonify({"message": "Entry updated successfully"})
    return error_response("Failed to save entry", 500)


@app.route("/grow-logs/<grow_id>/entries/<entry_id>", methods=["DELETE"])
async def delete_grow_entry(grow_id, entry_id):
    """Delete an entry from a grow."""
    logs = load_grow_logs()
    grow = get_grow(logs, grow_id)
    if not grow:
        return error_response("Entry not found", 404)
    grow["entries"] = [e for e in grow.get("entries", []) if e.get("id") != entry_id]
    if save_grow_logs(logs):
        return jsonify({"message": "Entry deleted successfully"})
    return error_response("Failed to delete entry", 500)


@app.route("/grow-logs/export", methods=["GET"])
async def export_grow_logs():
    """Export grow logs as CSV or JSON download. Query: format=csv or format=json."""
    fmt = (request.args.get("format") or "csv").strip().lower()
    if fmt not in ("csv", "json"):
        return error_response("format must be csv or json", 400)
    date_str = datetime.now().strftime("%Y-%m-%d")
    if fmt == "csv":
        rows = list(export_grows_to_csv_rows())
        fieldnames = list(rows[0].keys()) if rows else [
            "grow_id",
            "start_date",
            "strains",
            "is_primary",
            "grow_notes",
            "entry_id",
            "entry_type",
            "timestamp",
            "pump_direction",
            "pump_duration",
            "ph_value",
            "is_manual",
            "nutrient_amount",
            "nutrient_unit",
            "strength_percent",
            "nutrients",
            "volume",
            "volume_unit",
            "note_text",
            "content",
        ]
        out = io.StringIO()
        writer = csv.DictWriter(out, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        body = out.getvalue()
        return body, 200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": f'attachment; filename="grow-logs-{date_str}.csv"',
        }
    # json
    data = load_grow_logs()
    body = json.dumps(data, indent=2)
    return body, 200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": f'attachment; filename="grow-logs-{date_str}.json"',
    }


# ✅ REST API to Update Settings (PIN required for protected keys)
@app.route("/settings", methods=["POST"])
async def update_settings():
    data = await request.get_json()
    if not isinstance(data, dict):
        return error_response("Invalid data format", 400)
    protected_keys = (
        "pump_settings",
        "sensor_intervals",
        "pH_monitoring_enabled",
        "ph_calibration",
        "influx_config",
    )
    if any(k in data for k in protected_keys):
        err = require_pin_session()
        if err is not None:
            return err[0], err[1]
    await save_settings(data)

    # ✅ Broadcast settings update to WebSocket clients
    asyncio.create_task(websocket_broadcast_loop())

    return jsonify({"message": "Settings updated successfully!"})

# ✅ REST API for Manual Pump Activation (requires PIN session)
@app.route("/activate-pump", methods=["POST"])
async def api_activate_pump():
    """Manually activate a pump (1 = pH Up, 2 = pH Down) for a specified duration."""
    err = require_pin_session()
    if err is not None:
        return err[0], err[1]
    try:
        data = await request.get_json()
        pump_number = data.get("pump")
        duration = data.get("duration")

        # ✅ Validate pump number
        if pump_number not in [1, 2]:
            return jsonify({"error": "Invalid pump number. Must be 1 (pH Up) or 2 (pH Down)."}), 400

        # ✅ Validate duration
        if not isinstance(duration, int) or duration <= 0 or duration > 30:
            return jsonify({"error": "Invalid duration. Must be a positive integer (1-30 seconds)."}), 400

        # Get current pH value for logging
        settings = load_settings()
        ph_value = settings.get("pH_value")
        
        # ✅ Activate pump asynchronously (mark as manual since this is the API endpoint)
        success = await activate_pump(pump_number, duration, ph_value=ph_value, is_manual=True)

        if success:
            return jsonify({"message": f"Pump {pump_number} activated successfully for {duration} seconds!"})
        else:
            return jsonify({"error": "Pump activation failed."}), 500

    except Exception as e:
        print(f"❌ Error in /activate-pump API: {e}")
        return jsonify({"error": "Internal server error."}), 500


# ✅ Restart the Backend Program (requires PIN session when PIN is configured)
@app.route("/restart-program", methods=["POST"])
async def restart_program():
    err = require_pin_session()
    if err is not None:
        return err[0], err[1]
    os.system("sudo systemctl restart api.service")
    return jsonify({"message": "Program restarted!"})

# ✅ Restart the Raspberry Pi (requires PIN session when PIN is configured)
@app.route("/restart-system", methods=["POST"])
async def restart_system():
    err = require_pin_session()
    if err is not None:
        return err[0], err[1]
    os.system("sudo reboot")
    return jsonify({"message": "System restarting..."})

# ✅ Shutdown the Raspberry Pi (requires PIN session when PIN is configured)
@app.route("/shutdown", methods=["POST"])
async def shutdown():
    err = require_pin_session()
    if err is not None:
        return err[0], err[1]
    os.system("sudo shutdown -h now")
    return jsonify({"message": "System shutting down..."})

# ✅ Start API Server and Background Services
if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    
    # ✅ Start monitoring, WebSocket loop, and OLED display
    loop.create_task(start_services())

    # ✅ Run Quart API in the same event loop
    loop.run_until_complete(app.run_task(host=API_HOST, port=API_PORT, debug=False))
