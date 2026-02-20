"""
PIN authentication for sensitive actions: manual pump, pH regulation, pH monitoring toggle.
PIN is hashed with PBKDF2; sessions expire after 5 minutes.
"""
import hashlib
import secrets
import base64
from datetime import datetime, timedelta

from settings import load_settings, SETTINGS_FILE

PIN_SESSION_MINUTES = 5
PIN_LENGTH = 4

# token -> { "expires_at": datetime }
_sessions = {}


def _get_pin_auth():
    """Return pin_auth dict from settings (salt_b64, hash_b64) or None if not configured."""
    settings = load_settings()
    pa = settings.get("pin_auth")
    if not isinstance(pa, dict) or not pa.get("salt") or not pa.get("hash"):
        return None
    return pa


def _save_pin_auth(salt_b64, hash_b64):
    """Write pin_auth into settings file (merge with existing settings)."""
    import json
    settings = load_settings()
    settings["pin_auth"] = {"salt": salt_b64, "hash": hash_b64}
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=4)


def is_pin_configured():
    """True if a PIN has been set (first-time setup already done)."""
    return _get_pin_auth() is not None


def hash_pin(pin, salt_bytes):
    """Return base64-encoded PBKDF2-HMAC-SHA256 hash of PIN with given salt."""
    raw = hashlib.pbkdf2_hmac(
        "sha256",
        pin.encode("utf-8"),
        salt_bytes,
        iterations=100000,
    )
    return base64.b64encode(raw).decode("ascii")


def verify_pin(pin):
    """Verify PIN against stored hash. Returns True if correct."""
    if not pin or len(pin) != PIN_LENGTH or not pin.isdigit():
        return False
    pa = _get_pin_auth()
    if not pa:
        return False
    try:
        salt_bytes = base64.b64decode(pa["salt"].encode("ascii"))
        stored = pa["hash"]
        return secrets.compare_digest(hash_pin(pin, salt_bytes), stored)
    except Exception:
        return False


def setup_pin(pin):
    """
    Set PIN for the first time. Fails if PIN already configured.
    Returns True on success.
    """
    if is_pin_configured():
        return False
    if not pin or len(pin) != PIN_LENGTH or not pin.isdigit():
        return False
    salt_bytes = secrets.token_bytes(32)
    salt_b64 = base64.b64encode(salt_bytes).decode("ascii")
    hash_b64 = hash_pin(pin, salt_bytes)
    _save_pin_auth(salt_b64, hash_b64)
    return True


def change_pin(current_pin, new_pin):
    """
    Change PIN. Requires current PIN to be correct.
    Returns True on success.
    """
    if not is_pin_configured():
        return False
    if not verify_pin(current_pin):
        return False
    if not new_pin or len(new_pin) != PIN_LENGTH or not new_pin.isdigit():
        return False
    salt_bytes = secrets.token_bytes(32)
    salt_b64 = base64.b64encode(salt_bytes).decode("ascii")
    hash_b64 = hash_pin(new_pin, salt_bytes)
    _save_pin_auth(salt_b64, hash_b64)
    return True


def create_session():
    """Create a new session; returns (token, expires_at). expires_at is datetime."""
    token = secrets.token_hex(32)
    expires_at = datetime.utcnow() + timedelta(minutes=PIN_SESSION_MINUTES)
    _sessions[token] = {"expires_at": expires_at}
    return token, expires_at


def get_session(token):
    """
    Return session info if token is valid and not expired: { "expires_at": datetime }.
    Return None otherwise. Expired entries are removed.
    """
    if not token:
        return None
    now = datetime.utcnow()
    if token not in _sessions:
        return None
    s = _sessions[token]
    if s["expires_at"] <= now:
        del _sessions[token]
        return None
    return s


def require_session(get_token):
    """
    Use as: require_session(lambda: request.headers.get("X-PIN-Session"))
    Returns (True, None) if valid session, else (False, (response, status_code)).
    """
    token = get_token() if callable(get_token) else get_token
    session = get_session(token)
    if session:
        return True, None
    from quart import jsonify
    return False, (jsonify({"error": "PIN required or session expired"}), 401)
