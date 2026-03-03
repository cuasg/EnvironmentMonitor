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


def _normalize_feeding_entry(entry):
    """
    Normalize feeding entries to the new schema with a per-nutrient list.

    Legacy shape:
      {
        "type": "feeding",
        "timestamp": "...",
        "nutrient_amount": 10,
        "nutrient_unit": "grams",
        "strength_percent": 100,
        ...
      }

    New shape:
      {
        "type": "feeding",
        "timestamp": "...",
        "nutrients": [
          {
            "name": <optional>,
            "amount": 10,
            "unit": "grams",
            "strength_percent": 100,
          },
          ...
        ],
        ...
      }
    """
    if not isinstance(entry, dict):
        return entry

    # Already new-style: normalize each nutrient dict
    if isinstance(entry.get("nutrients"), list) and entry["nutrients"]:
        normalized_nutrients = []
        for n in entry["nutrients"]:
            if not isinstance(n, dict):
                continue
            amount = n.get("amount")
            try:
                amount = float(amount) if amount is not None else None
            except (TypeError, ValueError):
                amount = None
            strength = n.get("strength_percent", 100)
            try:
                strength = int(strength)
            except (TypeError, ValueError):
                strength = 100
            normalized_nutrients.append(
                {
                    "name": (n.get("name") or None),
                    "amount": amount,
                    "unit": (n.get("unit") or "grams"),
                    "strength_percent": strength,
                }
            )
        entry["nutrients"] = normalized_nutrients
        return entry

    # Legacy single-nutrient fields -> wrap into a list
    legacy_amount = entry.get("nutrient_amount")
    legacy_unit = entry.get("nutrient_unit") or "grams"
    legacy_strength = entry.get("strength_percent", 100)

    if legacy_amount is None and legacy_unit is None and legacy_strength is None:
        # Nothing to normalize
        return entry

    try:
        legacy_amount = float(legacy_amount) if legacy_amount is not None else None
    except (TypeError, ValueError):
        legacy_amount = None

    try:
        legacy_strength = int(legacy_strength)
    except (TypeError, ValueError):
        legacy_strength = 100

    entry["nutrients"] = [
        {
            "name": None,
            "amount": legacy_amount,
            "unit": legacy_unit,
            "strength_percent": legacy_strength,
        }
    ]
    return entry


def _normalize_grow(grow):
    """Ensure grow has strains (list) with per-strain fields. No harvest_date at grow level."""
    if not isinstance(grow, dict):
        return grow
    grow_start = grow.get("start_date") or ""
    if "strains" not in grow or not isinstance(grow.get("strains"), list):
        legacy = grow.get("strain", "")
        if legacy:
            grow["strains"] = [
                {
                    "name": legacy,
                    "start_date": grow_start,
                    "days_to_finish": None,
                    "actual_harvest_date": None,
                    "strain_type": grow.get("strain_type", "Hybrid"),
                    "plant_type": grow.get("plant_type", "Photo"),
                }
            ]
        else:
            grow["strains"] = []
    for s in grow["strains"]:
        _normalize_strain(s, grow_start)
    if "harvest_date" in grow:
        del grow["harvest_date"]

    # Normalize entries (feeding schema, etc.)
    entries = grow.get("entries")
    if isinstance(entries, list):
        for entry in entries:
            if isinstance(entry, dict) and entry.get("type") == "feeding":
                _normalize_feeding_entry(entry)
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
            # Feeding entries may use the new nutrients[] schema; derive summary fields.
            nutrients = entry.get("nutrients") if isinstance(entry.get("nutrients"), list) else None
            nutrient_amount = entry.get("nutrient_amount", "")
            nutrient_unit = entry.get("nutrient_unit", "")
            strength_percent = entry.get("strength_percent", "")
            nutrients_summary = ""
            if nutrients:
                parts = []
                for n in nutrients:
                    if not isinstance(n, dict):
                        continue
                    name = n.get("name") or ""
                    amount = n.get("amount")
                    unit = n.get("unit") or ""
                    sp = n.get("strength_percent")
                    try:
                        amount_str = "" if amount is None else str(amount)
                    except Exception:
                        amount_str = ""
                    try:
                        sp_str = "" if sp is None else str(int(sp))
                    except Exception:
                        sp_str = ""
                    label = name or "Nutrient"
                    details = []
                    if amount_str and unit:
                        details.append(f"{amount_str} {unit}")
                    if sp_str:
                        details.append(f"@ {sp_str}%")
                    fragment = label
                    if details:
                        fragment = f"{fragment}: " + " ".join(details)
                    parts.append(fragment)
                nutrients_summary = "; ".join(p for p in parts if p)

                # For backward-compatible scalar fields, take the first nutrient if present.
                first = next((n for n in nutrients if isinstance(n, dict)), None)
                if first is not None:
                    if first.get("amount") is not None:
                        nutrient_amount = first.get("amount")
                    if first.get("unit"):
                        nutrient_unit = first.get("unit")
                    if first.get("strength_percent") is not None:
                        strength_percent = first.get("strength_percent")

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
                "nutrient_amount": nutrient_amount,
                "nutrient_unit": nutrient_unit,
                "strength_percent": strength_percent,
                "nutrients": nutrients_summary,
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
