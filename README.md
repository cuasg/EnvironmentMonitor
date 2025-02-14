# 🌿 Environment Monitor

A **real-time environmental monitoring system** designed to track and control key environmental factors, such as **pH, Total Dissolved Solids (TDS), temperature, humidity, and light intensity**. The system provides **live updates, historical data visualization, and automated pH regulation** for hydroponic or aquaponic setups.

---

## 🚀 Features

### 📡 Real-Time Monitoring
- **Live sensor readings** update every 5 seconds.
- **WebSocket integration** for instant updates without page refresh.

### 📊 Data Logging & Visualization
- **InfluxDB** stores sensor data for long-term analysis.
- **Historical charts** for **pH, TDS, temperature, and light intensity**.

### 🔬 Automated pH Regulation
- **Dual peristaltic pump system** for precise pH adjustments.
- **Customizable pH range** with real-time feedback.
- **Smart stabilization time** before rechecking pH.

### 🛠️ Control Panel
- **Manual pump activation** with adjustable duration.
- **pH Calibration panel** for **2-point or 3-point calibration**.
- **Dynamic range slider** for pH control limits.

### ⚙️ System Settings
- **Fully configurable** settings via the UI.
- **Save & restore settings** between sessions.
- **Automated system health checks**.

### 💻 Modern Web Interface
- **Built with React + Vite frontend** for a sleek UI.
- **Quart (Python) backend** for efficient data handling.

---

## 📦 Project Structure
EnvironmentMonitor/ │── backend/ # Quart-based API for sensor control │ ├── main.py # Core application logic │ ├── api.py # REST API routes │ ├── settings.py # Load/save persistent settings │ ├── influx_logger.py # Data logging to InfluxDB │ ├── pump_control.py # Pump activation & regulation logic │ ├── websocket.py # Live data streaming │ │── frontend/ # React-based UI with Vite │ ├── src/ │ │ ├── pages/ # UI pages (Dashboard, Control Panel) │ │ ├── components/ # Reusable UI components │ │ ├── styles/ # CSS styling │ │ ├── api.js # API request handling │ │ ├── App.jsx # Main frontend app │ │── README.md # This file │── requirements.txt # Python dependencies │── package.json # Frontend dependencies │── .gitignore # Files to ignore in Git

---

## ⚡ Installation Guide

### 1️⃣ Clone the Repository
```bash
git clone https://github.com/cuasg/EnvironmentMonitor.git
cd EnvironmentMonitor


2️⃣ Backend Setup (Python)
Install Dependencies

cd backend
pip install -r requirements.txt

Start the Backend
python main.py

3️⃣ Frontend Setup (React + Vite)
Install Dependencies
cd frontend
npm install

Start the Frontend
npm run dev

The frontend should be accessible at http://localhost:5173.

🔧 Configuration
Environment Variables
Create a .env file in the backend/ directory with:

INFLUXDB_URL=http://your-influxdb-url
INFLUXDB_TOKEN=your-token
INFLUXDB_BUCKET=plantMonitor
INFLUXDB_ORG=HomeSensors

Editing Settings
Sensor update intervals
pH calibration points
Pump activation times
Threshold values
All settings are saved in settings.json and can be modified via the UI.

🚀 API Endpoints
Method	Endpoint	Description
GET	/settings	Get system settings
POST	/settings	Update system settings
POST	/activate-pump	Manually activate pump
POST	/restart-program	Restart backend process
POST	/restart-system	Restart Raspberry Pi
POST	/shutdown	Shut down Raspberry Pi

📡 WebSocket Integration
WebSocket URL: ws://10.0.0.207:5000/ws/settings
Live updates push sensor readings every 5 seconds.

🛠️ Troubleshooting
1️⃣ WebSocket not updating?
Refresh the page manually.
Ensure the backend is running: python main.py.
Check the WebSocket URL in api.js.
2️⃣ pH Regulation Not Working?
Ensure pH monitoring is enabled in the UI.
Verify pump wiring and GPIO settings.
3️⃣ React Frontend Not Loading?
Check if Vite is running: npm run dev.
Clear the cache: Ctrl + Shift + R.

📜 License
This project is open-source under the MIT License.

📧 Contact
For questions or support, reach out at cuasg@github.com.

