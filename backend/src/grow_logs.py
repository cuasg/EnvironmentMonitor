"""
Grow Log management - stores and retrieves grow log data.
"""
import json
import os
from datetime import datetime
from settings import _SETTINGS_DIR

GROW_LOGS_FILE = os.path.join(_SETTINGS_DIR, "grow_logs.json")


def _normalize_strain(s, grow_start_date):
    """Ensure strain has start_date, days_to_finish, actual_harvest_date, strain_type, plant_type."""
    if not isinstance(s, dict):
        return s
    start = s.get("start_date") or grow_start_date or ""
    s["start_date"] = start
    if "days_to_finish" not in s:
        s["days_to_finish"] = None
    if "actual_harvest_date" not in s:
        s["actual_harvest_date"] = None
    if "strain_type" not in s or s.get("strain_type") not in ("Indica", "Sativa", "Hybrid"):
        s["strain_type"] = s.get("strain_type") or "Hybrid"
    if "plant_type" not in s or s.get("plant_type") not in ("Auto", "Photo"):
        s["plant_type"] = s.get("plant_type") or "Photo"
    return s


def _normalize_grow(grow):
    """Ensure grow has strains (list) with per-strain fields. No harvest_date at grow level."""
    if not isinstance(grow, dict):
        return grow
    grow_start = grow.get("start_date") or ""
    if "strains" not in grow or not isinstance(grow.get("strains"), list):
        legacy = grow.get("strain", "")
        if legacy:
            grow["strains"] = [{"name": legacy, "start_date": grow_start, "days_to_finish": None, "actual_harvest_date": None, "strain_type": grow.get("strain_type", "Hybrid"), "plant_type": grow.get("plant_type", "Photo")}]
        else:
            grow["strains"] = []
    for s in grow["strains"]:
        _normalize_strain(s, grow_start)
    if "harvest_date" in grow:
        del grow["harvest_date"]
    return grow


def load_grow_logs():
    """Load grow logs from JSON file. Normalizes each grow to have strains list and harvest_date."""
    if not os.path.exists(GROW_LOGS_FILE):
        return {"grows": []}
    
    try:
        with open(GROW_LOGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, dict) or "grows" not in data:
                return {"grows": []}
            for grow in data.get("grows", []):
                _normalize_grow(grow)
            return data
    except Exception as e:
        print(f"⚠️ Error loading grow logs: {e}")
        return {"grows": []}


def save_grow_logs(data):
    """Save grow logs to JSON file."""
    try:
        with open(GROW_LOGS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        return True
    except Exception as e:
        print(f"❌ Error saving grow logs: {e}")
        return False


def get_primary_grow():
    """Get the primary grow (if any)."""
    logs = load_grow_logs()
    for grow in logs.get("grows", []):
        if grow.get("is_primary", False):
            return grow
    return None


def get_grow(logs, grow_id):
    """Return the grow dict with the given id, or None. Caller must have loaded logs."""
    for grow in logs.get("grows", []):
        if grow.get("id") == grow_id:
            return grow
    return None


def get_entry(grow, entry_id):
    """Return the entry dict with the given id in the grow, or None."""
    for entry in grow.get("entries", []):
        if entry.get("id") == entry_id:
            return entry
    return None


def export_grows_to_csv_rows():
    """Yield row dicts for CSV export: one row per entry, with grow metadata + entry fields flattened."""
    logs = load_grow_logs()
    for grow in logs.get("grows", []):
        grow_id = grow.get("id", "")
        start_date = grow.get("start_date", "")
        strains = grow.get("strains", [])
        def _strain_export_text(s):
            if not isinstance(s, dict) or not s.get("name"):
                return ""
            parts = [s.get("name", "")]
            extra = []
            if s.get("strain_type"):
                extra.append(s.get("strain_type", ""))
            if s.get("plant_type"):
                extra.append(s.get("plant_type", ""))
            has_suffix = extra or s.get("days_to_finish") not in (None, "")
            if has_suffix:
                parts.append(" (")
                if extra:
                    parts.append("/".join(extra))
                if s.get("days_to_finish") not in (None, ""):
                    if extra:
                        parts.append(", ")
                    parts.append(f"{s.get('days_to_finish')}d")
                parts.append(")")
            return "".join(parts)

        strains_summary = ", ".join(_strain_export_text(s) for s in (strains or []) if _strain_export_text(s))
        is_primary = grow.get("is_primary", False)
        notes = grow.get("notes", "")
        for entry in grow.get("entries", []):
            row = {
                "grow_id": grow_id,
                "start_date": start_date,
                "strains": strains_summary,
                "is_primary": "yes" if is_primary else "no",
                "grow_notes": notes,
                "entry_id": entry.get("id", ""),
                "entry_type": entry.get("type", ""),
                "timestamp": entry.get("timestamp", ""),
                "pump_direction": entry.get("pump_direction", ""),
                "pump_duration": entry.get("pump_duration", ""),
                "ph_value": entry.get("ph_value", ""),
                "is_manual": entry.get("is_manual", ""),
                "nutrient_amount": entry.get("nutrient_amount", ""),
                "nutrient_unit": entry.get("nutrient_unit", ""),
                "strength_percent": entry.get("strength_percent", ""),
                "volume": entry.get("volume", ""),
                "volume_unit": entry.get("volume_unit", ""),
                "note_text": entry.get("note_text", ""),
                "content": entry.get("content", ""),
            }
            yield row


def log_pump_activation(pump_label, timestamp, ph_value, is_manual=False, duration_seconds=None):
    """Log a pump activation to the primary grow's log.
    duration_seconds: how long the pump ran (seconds), if known.
    """
    primary_grow = get_primary_grow()
    if not primary_grow:
        return False
    
    logs = load_grow_logs()
    for grow in logs.get("grows", []):
        if grow.get("id") == primary_grow.get("id"):
            if "entries" not in grow:
                grow["entries"] = []
            
            entry = {
                "id": f"pump_{datetime.now().timestamp()}",
                "type": "pump_activation",
                "timestamp": timestamp,
                "pump_direction": pump_label,  # "up" or "down"
                "ph_value": ph_value,
                "is_manual": is_manual,
            }
            if duration_seconds is not None:
                entry["pump_duration"] = duration_seconds
            grow["entries"].append(entry)
            break
    
    return save_grow_logs(logs)
