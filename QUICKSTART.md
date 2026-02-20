# Plant Monitor — Quick Start Guide

This guide gets you from a fresh clone to a running app: backend, frontend, optional InfluxDB, and (optionally) a Raspberry Pi with remote access.

---

## 1. Prerequisites

Install once:

| What | Version / notes |
|------|------------------|
| **Python** | 3.10 or newer |
| **Node.js** | 18+ (LTS recommended) |
| **InfluxDB** | 2.x — optional; needed for Trends and sensor history. Install on a machine reachable from the Pi (same LAN or via Tailscale). |

**InfluxDB one-time setup (if you use it):**

1. Install InfluxDB 2.x and open the UI (e.g. `http://your-influx-host:8086`).
2. Create an **organization** (e.g. `HomeSensors`) and a **bucket** (e.g. `plantMonitor`).
3. Create an **API token** with read/write access to that bucket. Copy the token; you’ll put it in `.env`.

---

## 2. Clone and open the project

```bash
git clone <your-repo-url> plant-monitor
cd plant-monitor/plant
```

(If the repo root is already `plant`, skip the `plant` subfolder.)

---

## 3. Backend setup

```bash
cd backend
python -m venv .venv
# On Windows:  .venv\Scripts\activate
# On macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
```

Create your config from the example (no secrets are in the repo):

```bash
cp .env.example src/.env
```

Edit `src/.env` and set at least:

- **InfluxDB (if you use it):**
  - `INFLUX_URL` — e.g. `http://192.168.1.5:8086` or `http://your-influx-host:8086`
  - `INFLUX_TOKEN` — the token you created in InfluxDB
  - `INFLUX_ORG` / `INFLUX_BUCKET` — optional; defaults are `HomeSensors` and `plantMonitor`

- **CORS (if you’ll open the UI from another machine):**
  - `PLANT_CORS_ORIGINS` — add the origin you use to open the app, e.g.  
    `http://localhost:5173,http://127.0.0.1:5173,http://192.168.1.10:5173`  
    (Replace `192.168.1.10` with your Pi or dev machine IP.)  
  - Tailscale IPs are allowed automatically; you only need to add MagicDNS hostnames (e.g. `http://mypi:5173`) if you use them.

Start the API:

```bash
cd src
python api.py
```

You should see the API listening on `0.0.0.0:5000`. Leave this running.

---

## 4. Frontend setup

In a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the URL shown (usually `http://localhost:5173`).  
On first load you’ll be asked to set a **4-digit PIN**; this protects pump control, settings, and system actions.

---

## 5. Verify

- **Dashboard** — Shows tiles; sensors may show placeholder or “no data” until hardware/settings are configured.
- **Health** — Check that API and (if configured) InfluxDB show as connected.
- **Trends** — If InfluxDB is configured and receiving data, charts will populate over time.

---

## 6. Run on a Raspberry Pi (optional)

- Copy the repo onto the Pi (or clone from git).
- On the Pi: create the venv, install backend deps, copy `.env.example` to `src/.env`, and fill in:
  - Your InfluxDB URL and token (use the Pi’s LAN IP or Tailscale IP to reach InfluxDB).
  - `PLANT_CORS_ORIGINS` if you’ll open the UI from a different device (e.g. `http://pi-ip:5173` or `http://mypi:5173` for MagicDNS).
- Run the backend from `backend/src`: `python api.py` (or use systemd for production).
- Run the frontend from `frontend/`: `npm run dev`, or build and serve: `npm run build` then serve the `dist/` folder on port 5173.

**Tailscale (remote access):**

1. Install Tailscale on the Pi and log in: `curl -fsSL https://tailscale.com/install.sh | sh` then `sudo tailscale up`.
2. Note the Pi’s Tailscale IP: `tailscale ip -4`.
3. No need to add that IP to CORS — Tailscale IPs are allowed automatically. If you use MagicDNS (e.g. `http://mypi:5173`), add that exact origin to `PLANT_CORS_ORIGINS`.
4. On your phone or laptop (with Tailscale and the same account), open `http://<pi-tailscale-ip>:5173`.

---

## 7. What to do next

- **Control Panel** — Calibrate pH, set pump duration, configure InfluxDB (if not using .env), change PIN.
- **Grow Log** — Create a grow, add strains, mark one as primary; then pump activations and “Track” from the Nutrient Calculator will attach to it.
- **README.md** — Full configuration, security, and troubleshooting.

---

## Summary checklist

- [ ] Python 3.10+ and Node 18+ installed  
- [ ] InfluxDB 2.x installed and token created (if using Trends)  
- [ ] Backend: `pip install -r requirements.txt`, `cp .env.example src/.env`, edit `src/.env`  
- [ ] Backend: `cd src && python api.py`  
- [ ] Frontend: `npm install && npm run dev`  
- [ ] Open app in browser, set PIN  
- [ ] (Optional) Add your UI origin to `PLANT_CORS_ORIGINS` if opening from another machine  
- [ ] (Optional) Run on Pi and/or set up Tailscale for remote access  
