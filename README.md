🌿 Environment Monitor
A real-time environmental monitoring system designed to track and control key environmental factors, such as pH, Total Dissolved Solids (TDS), temperature, humidity, and light intensity. The system provides live updates, historical data visualization, and automated pH regulation for hydroponic or aquaponic setups.

🚀 Features
📡 Real-Time Monitoring
Live sensor readings update every 5 seconds.
WebSocket integration for instant updates without page refresh.
📊 Data Logging & Visualization
InfluxDB stores sensor data for long-term analysis.
Historical charts for pH, TDS, temperature, and light intensity.
🔬 Automated pH Regulation
Dual peristaltic pump system for precise pH adjustments.
Customizable pH range with real-time feedback.
Smart stabilization time before rechecking pH.
🛠️ Control Panel
Manual pump activation with adjustable duration.
pH Calibration panel for 2-point or 3-point calibration.
Dynamic range slider for pH control limits.
⚙️ System Settings
Fully configurable settings via the UI.
Save & restore settings between sessions.
Automated system health checks.
💻 Modern Web Interface
Built with React + Vite frontend for a sleek UI.
Quart (Python) backend for efficient data handling.
📦 Project Structure

EnvironmentMonitor/
│── backend/             # Quart-based API for sensor control
│   ├── main.py          # Core application logic
│   ├── api.py           # REST API routes
│   ├── settings.py      # Load/save persistent settings
│   ├── influx_logger.py # Data logging to InfluxDB
│   ├── pump_control.py  # Pump activation & regulation logic
│   ├── websocket.py     # Live data streaming
│
│── frontend/            # React-based UI with Vite
│   ├── src/
│   │   ├── pages/       # UI pages (Dashboard, Control Panel)
│   │   ├── components/  # Reusable UI components
│   │   ├── styles/      # CSS styling
│   │   ├── api.js       # API request handling
│   │   ├── App.jsx      # Main frontend app
│
│── README.md            # This file
│── requirements.txt     # Python dependencies
│── package.json         # Frontend dependencies
│── .gitignore           # Files to ignore in Git

