import asyncio
import json
import os
import subprocess
from quart import Quart, websocket, request, jsonify
from quart_cors import cors
from settings import load_settings, save_settings
from pumps import activate_pump
from main import main  # ✅ Import the continuous monitoring loop
from oled_display import async_display_oled  # ✅ Import OLED function
from datetime import datetime

app = Quart(__name__)
app = cors(app, allow_origin="http://10.0.0.207:5173")  # ✅ Allow frontend requests

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

# ✅ REST API to Fetch Settings
@app.route("/settings", methods=["GET"])
async def get_settings():
    return jsonify(load_settings())

# ✅ REST API to Update Settings
@app.route("/settings", methods=["POST"])
async def update_settings():
    data = await request.get_json()
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid data format"}), 400
    
    await save_settings(data)

    # ✅ Broadcast settings update to WebSocket clients
    asyncio.create_task(websocket_broadcast_loop())

    return jsonify({"message": "Settings updated successfully!"})

# ✅ REST API for Manual Pump Activation
@app.route("/activate-pump", methods=["POST"])
async def api_activate_pump():
    """Manually activate a pump (1 = pH Up, 2 = pH Down) for a specified duration."""
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

        # ✅ Activate pump asynchronously
        success = await activate_pump(pump_number, duration)

        if success:
            return jsonify({"message": f"Pump {pump_number} activated successfully for {duration} seconds!"})
        else:
            return jsonify({"error": "Pump activation failed."}), 500

    except Exception as e:
        print(f"❌ Error in /activate-pump API: {e}")
        return jsonify({"error": "Internal server error."}), 500


# ✅ Restart the Backend Program
@app.route("/restart-program", methods=["POST"])
async def restart_program():
    os.system("sudo systemctl restart api.service")
    return jsonify({"message": "Program restarted!"})

# ✅ Restart the Raspberry Pi
@app.route("/restart-system", methods=["POST"])
async def restart_system():
    os.system("sudo reboot")
    return jsonify({"message": "System restarting..."})

# ✅ Shutdown the Raspberry Pi
@app.route("/shutdown", methods=["POST"])
async def shutdown():
    os.system("sudo shutdown -h now")
    return jsonify({"message": "System shutting down..."})

# ✅ Start API Server and Background Services
if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    
    # ✅ Start monitoring, WebSocket loop, and OLED display
    loop.create_task(start_services())

    # ✅ Run Quart API in the same event loop
    loop.run_until_complete(app.run_task(host="0.0.0.0", port=5000, debug=False))
