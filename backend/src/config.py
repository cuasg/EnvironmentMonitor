"""
Environment-based configuration. No secrets in code.
Load from .env file (if present) then os.environ.
"""
import os
import re

# Same base directory as settings.json (Pi, WSL, or override)
_CONFIG_DIR = os.environ.get(
    "PLANT_SETTINGS_DIR",
    os.path.dirname(os.path.abspath(__file__)),
)
_ENV_FILE = os.path.join(_CONFIG_DIR, ".env")


def _load_dotenv():
    """Load .env file into os.environ if file exists. Checks multiple locations."""
    # Check primary location (same dir as config.py or PLANT_SETTINGS_DIR)
    env_files = [_ENV_FILE]
    
    # Also check parent directory (backend/.env) as fallback
    parent_env = os.path.join(os.path.dirname(_CONFIG_DIR), ".env")
    if parent_env != _ENV_FILE:
        env_files.append(parent_env)
    
    for env_file in env_files:
        if os.path.isfile(env_file):
            try:
                with open(env_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        if "=" in line:
                            key, _, value = line.partition("=")
                            key = key.strip()
                            value = value.strip().strip('"').strip("'")
                            if key and key not in os.environ:
                                os.environ[key] = value
                return
            except Exception as e:
                continue


_load_dotenv()


def _str(key: str, default: str = "") -> str:
    return (os.environ.get(key) or default).strip()


def _int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, default))
    except ValueError:
        return default


# --- InfluxDB (never commit real values) ---
INFLUX_URL = _str("INFLUX_URL", "http://localhost:8086")
INFLUX_TOKEN = _str("INFLUX_TOKEN")
INFLUX_ORG = _str("INFLUX_ORG", "HomeSensors")
INFLUX_BUCKET = _str("INFLUX_BUCKET", "plantMonitor")

# InfluxDB config loaded from env; no startup print to reduce Pi Zero I/O


def influx_configured() -> bool:
    """True if InfluxDB has enough config to connect (URL and token)."""
    return bool(INFLUX_URL and INFLUX_TOKEN)


# --- API server (Tailscale-friendly: bind 0.0.0.0, no port expose needed) ---
API_HOST = _str("PLANT_API_HOST", "0.0.0.0")
API_PORT = _int("PLANT_API_PORT", 5000)


# --- CORS: allow frontend origins; Tailscale 100.x.x.x and LAN IPs allowed ---
# Tailscale CGNAT range 100.64.0.0/10 → second octet 64–127
_TAILSCALE_ORIGIN_REGEX = re.compile(
    r"^https?://100\.(6[4-9]|[7-9]\d|1[0-2]\d)\.\d{1,3}\.\d{1,3}(:\d+)?$"
)
# LAN: 10.x, 192.168.x, 172.16–31.x (and localhost)
_LAN_ORIGIN_REGEX = re.compile(
    r"^https?://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$",
    re.IGNORECASE,
)


def _cors_explicit_origins() -> list:
    raw = _str("PLANT_CORS_ORIGINS")
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    # Defaults: local dev only. Add your LAN/Tailscale origin via PLANT_CORS_ORIGINS.
    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


_CORS_EXPLICIT = _cors_explicit_origins()


def allow_origin(origin: str) -> bool:
    """Return True if origin is allowed (explicit list, Tailscale, or LAN). Used by CORS middleware."""
    if not origin:
        return False
    if origin in _CORS_EXPLICIT:
        return True
    if _TAILSCALE_ORIGIN_REGEX.match(origin):
        return True
    if _LAN_ORIGIN_REGEX.match(origin):
        return True
    return False


# List for quart_cors: explicit origins + Tailscale + LAN regex (quart_cors does not support a callable)
CORS_ORIGINS = _CORS_EXPLICIT
CORS_ALLOW_ORIGIN_LIST = _CORS_EXPLICIT + [_TAILSCALE_ORIGIN_REGEX, _LAN_ORIGIN_REGEX]
