# Plant Monitor

Web UI and backend for monitoring plant sensors (pH, TDS, light, humidity, temperature), controlling pumps, viewing trends from InfluxDB, managing grow logs, and configuring calibration and settings. Designed to run on a Raspberry Pi with optional remote access via Tailscale (no port forwarding).

**First time here?** → **[QUICKSTART.md](QUICKSTART.md)** for a step-by-step setup from a clean clone.

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Features](#features)
- [Project structure](#project-structure)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [PIN protection](#pin-protection)
- [Grow logs](#grow-logs)
- [Remote access (Tailscale)](#remote-access-tailscale)
- [API overview](#api-overview)
- [Making it your own](#making-it-your-own)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Python 3.10+** (backend). Create a venv if you like: `python -m venv .venv` then activate and `pip install -r requirements.txt`.
- **Node.js 18+** and npm (frontend). Run `npm install` in `frontend/`.
- **InfluxDB 2.x** (optional but recommended for Trends and sensor history). Install and run InfluxDB, create an organization and bucket (e.g. `plantMonitor`), and create an API token with write/read access. The app uses env vars for URL, token, org, and bucket—no hardcoded values.
- **Raspberry Pi** (optional). The app can run on a Pi with GPIO/sensors; hardware-specific deps are commented in `requirements.txt` and only needed when not in dev mode.

For a step-by-step setup from a clean clone, see **[QUICKSTART.md](QUICKSTART.md)**.

---

## Features

| Area | Description |
|------|-------------|
| **Dashboard** | Live sensor tiles (pH, TDS/PPM, light, environment), pump control (duration + UP/DOWN with PIN), OLED preview, draggable tiles, sensor trends graph. |
| **Trends** | InfluxDB-backed charts for selected sensors; configurable time range; pH thresholds. |
| **Grow Log** | Multiple grows; each grow has a start date and multiple **strains**. Per strain: name, start date, days to finish, estimated harvest (start + days), actual harvest date, type (Indica/Sativa/Hybrid), Auto/Photo. Entries: pump activations (manual/auto, with duration), reservoir changes, feedings, notes. Export CSV/JSON. |
| **Nutrient Calculator** | Reservoir size, nutrient mix, strength %; calculates amount needed. **Track** writes a feeding entry + reservoir change to the primary grow (amount rounded to 2 decimals). |
| **Control Panel** | pH calibration, pump duration/stabilization, manual pump control (PIN required each time), OLED layout editor, InfluxDB config, change PIN. |
| **Health** | Status page for API, InfluxDB, recent sensors, settings file, grow logs file. |
| **Kiosk** | `/kiosk` and `/kiosk/dashboard`: navbar hidden, optional fullscreen; for wall-mounted displays. |

---

## Project structure

| Path | Description |
|------|-------------|
| `backend/` | Python API (Quart), sensor loop, InfluxDB, OLED display. Run from `backend/src/`. |
| `frontend/` | React + Vite app: Dashboard, Trends, Nutrient Calculator, Grow Log, Control Panel, Health. |
| `backend/src/config.py` | Environment-based config; no secrets in code. |
| `backend/src/settings.json` | Runtime settings (calibration, pump, intervals); created/updated by API. |
| `backend/src/grow_logs.json` | Grow log data (grows, strains, entries); created/updated by API. |
| `backend/.env.example` | Template for `.env`. Copy to `backend/src/.env` (or `PLANT_SETTINGS_DIR`) and fill in values. |

---

## Quick start

### Backend

1. Copy `backend/.env.example` to `backend/src/.env` and set at least `INFLUX_URL` and `INFLUX_TOKEN` if you use InfluxDB (see [Configuration](#configuration)).
2. From `backend/src/`:
   ```bash
   python api.py
   ```
   API listens on `0.0.0.0:5000` by default.

### Frontend

From `frontend/`:

```bash
npm install
npm run dev
```

Open `http://localhost:5173` (or the host/IP you use; see [Remote access](#remote-access-tailscale)).

On first run you’ll be prompted to set a 4-digit PIN; this protects pump activation, settings changes, and system actions (restart/shutdown).

---

## Configuration

All sensitive and environment-specific values use **environment variables** or an optional **`.env` file**. Never commit `.env`; it is in `backend/.gitignore`.

| Variable | Purpose | Required |
|----------|---------|----------|
| `INFLUX_URL` | InfluxDB base URL (e.g. `http://10.0.0.249:8086`) | For Influx features |
| `INFLUX_TOKEN` | InfluxDB API token | For Influx features |
| `INFLUX_ORG` | InfluxDB organization | Optional (default: HomeSensors) |
| `INFLUX_BUCKET` | InfluxDB bucket name | Optional (default: plantMonitor) |
| `PLANT_CORS_ORIGINS` | Comma-separated allowed frontend origins | Optional (defaults + Tailscale IPs) |
| `PLANT_API_HOST` | Bind address (default `0.0.0.0`) | Optional |
| `PLANT_API_PORT` | API port (default `5000`) | Optional |
| `PLANT_SETTINGS_DIR` | Directory for `settings.json`, `.env`, `grow_logs.json` | Optional |
| `PLANT_DEBUG` | Set to `1` for verbose debug logging (default: minimal for Pi Zero) | Optional |

- **Option A:** Put a `.env` file in `backend/src/` (next to `config.py`) or in the directory set by `PLANT_SETTINGS_DIR`. Copy from `backend/.env.example`.
- **Option B:** Export variables in the shell or in your process manager (e.g. systemd).

---

## PIN protection

- **First run:** The app prompts for a 4-digit PIN to create; this is stored hashed and never sent in full.
- **Pump actions:** Every pump UP/DOWN (Dashboard or Control Panel) requires entering the PIN; there is no “remember me” for pumps.
- **Other protected actions:** Saving calibration, pH regulation, InfluxDB config, restart program, restart Pi, shutdown—all require a valid PIN session (you may be prompted once per session for these).
- **Change PIN:** Control Panel → Change PIN (current PIN required).

---

## Grow logs

- **Grows** have a single **start date** and **notes**. One grow can be set as **primary** (used for automatic pump logging and for “Track” from the Nutrient Calculator).
- **Strains** (per grow): name, **start date** (defaults to grow start; can stagger), **days to finish** (optional), **estimated harvest** (start + days, shown in UI), **actual harvest date** (optional), **strain type** (Indica/Sativa/Hybrid), **plant type** (Auto/Photo).
- **Entries** (per grow): pump activations (with duration), reservoir changes, nutrient feedings, notes. Pump entries are added automatically when the primary grow is set.
- **Export:** Grow Log → Export CSV or Export JSON (includes grows, strains, and entries).

---

## Remote access (Tailscale)

You can use the Web UI from outside your home network over [Tailscale](https://tailscale.com) **without opening ports** on your router. Use the same Tailscale account as other devices (e.g. Unraid).

### 1. Install Tailscale on the Pi

On the machine running the backend (e.g. Raspberry Pi):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Log in with your Tailscale account.

### 2. Get the Pi’s Tailscale identity

```bash
tailscale ip -4
tailscale status
```

Note the Tailscale IP (e.g. `100.64.0.1`) and the machine name (e.g. `mypi`).

### 3. Configure the app

- **`.env`:** Create `backend/src/.env` from `backend/.env.example` and set InfluxDB and any other vars (see [Configuration](#configuration)).
- **CORS:** Origins in the Tailscale range `http(s)://100.64.x.x`–`100.127.x.x` (any port) are **allowed automatically**. If you open the UI at `http://100.64.0.1:5173`, no CORS change is needed. If you use **MagicDNS** (e.g. `http://mypi:5173`), add it to `PLANT_CORS_ORIGINS` in `.env`:
  ```bash
  PLANT_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://mypi:5173
  ```
- The backend binds to `0.0.0.0:5000` by default, so it is reachable on the Tailscale interface without further config.

### 4. Start backend and frontend

- Start the backend from `backend/src/`.
- Start the frontend from `frontend/` (e.g. `npm run dev`) so it is reachable on the Pi at port 5173 (or build and serve it on the same host).

### 5. Open the UI from another device

On a phone or laptop with Tailscale installed and logged in to the same account, open in a browser:

- `http://YOUR_TAILSCALE_IP:5173` or `http://YOUR_TAILSCALE_NAME:5173`

Use the port where the frontend is served. No port forwarding is required; traffic stays on Tailscale’s encrypted network.

---

## API overview

| Area | Endpoints |
|------|-----------|
| **Settings** | `GET/POST /settings` |
| **Auth** | `GET /auth/status`, `POST /auth/setup`, `POST /auth/verify`, `POST /auth/change-pin` |
| **Trends** | `GET /trends` |
| **Health** | `GET /health` |
| **Grow logs** | `GET/POST /grow-logs`, `PUT/DELETE /grow-logs/<id>`, `POST /grow-logs/<id>/entries`, `PUT/DELETE /grow-logs/<id>/entries/<eid>`, `GET /grow-logs/export?format=csv|json` |
| **OLED** | `GET/POST /oled/config`, `GET /oled/display` |
| **Influx** | `GET /influx/status`, `GET/POST /influx/config` |
| **Pump / system** | `POST /activate-pump`, `POST /restart-program`, `POST /restart-system`, `POST /shutdown` (PIN required when configured) |

Protected routes accept the session token in the `X-PIN-Session` header after PIN verification.

---

## Making it your own

The project is set up so you can clone it and run it without editing code:

- **No hardcoded IPs or tokens.** Backend uses `.env` (or env vars) for InfluxDB URL, token, org, bucket, and CORS origins. The frontend uses the same host as the page for API/WebSocket, so it works on localhost, LAN, or Tailscale without rebuilds.
- **Default CORS** allows only `http://localhost:5173` and `http://127.0.0.1:5173`. For another machine (e.g. your Pi’s LAN IP or Tailscale), set `PLANT_CORS_ORIGINS` in `.env` to include that origin (e.g. `http://192.168.1.10:5173`). Tailscale IPs in the `100.64.x.x`–`100.127.x.x` range are always allowed.
- **PIN** is set on first use and stored hashed; no default PIN.
- **Settings and grow logs** are stored in `backend/src/` (or `PLANT_SETTINGS_DIR`) as `settings.json` and `grow_logs.json`; they are created at runtime and can be backed up or moved.

---

## Security

- **No secrets in code.** InfluxDB URL, token, org, and bucket are read only from env or `.env`. The repo must not contain real tokens or passwords.
- **CORS:** The API only accepts requests from allowed origins. Defaults include `localhost:5173` and one LAN IP. **Tailscale IPs are allowed automatically** (see [Remote access](#remote-access-tailscale)). For MagicDNS hostnames (e.g. `http://mypi:5173`), add that origin to `PLANT_CORS_ORIGINS`.
- **Optional hardening:** Run the backend as a non-root user; use a reverse proxy (e.g. Caddy) with TLS for HTTPS; keep the Pi and Tailscale client updated.

---

## Troubleshooting

- **CORS errors:** Tailscale IP origins (`100.64.x.x`–`100.127.x.x`) are allowed automatically. For MagicDNS hostnames, add the exact origin (e.g. `http://mypi:5173`) to `PLANT_CORS_ORIGINS`.
- **Can’t reach the Pi over Tailscale:** Run `tailscale status` on both devices; both must be on the same Tailscale network and connected.
- **API not reachable:** Ensure the backend is bound to `0.0.0.0` (default). If you set `PLANT_API_HOST`, use `0.0.0.0` or leave it unset.
- **InfluxDB:** If `INFLUX_TOKEN` or `INFLUX_URL` is missing, trends and sensor logging to InfluxDB are skipped; the rest of the app still runs.
- **PIN / auth:** If you see “set up PIN” again after already setting it, check that the frontend can reach the backend (CORS and network). Auth state is checked via `GET /auth/status`.
