from collections import deque
from datetime import datetime
from typing import Any, Dict, List


_LOG_MAX_ENTRIES = 200  # keep this small to minimize memory usage
_ph_checks: deque[Dict[str, Any]] = deque(maxlen=_LOG_MAX_ENTRIES)


def log_ph_check(
    ts: datetime,
    readings: List[float],
    avg_value: float | None,
    samples_required: int,
    samples_available: int,
    reason: str,
) -> None:
    """
    Append a lightweight entry describing a pH monitoring check.

    Stores only a small, fixed-size ring buffer in memory to avoid disk I/O
    and keep resource usage low. Entries are ordered by timestamp.
    """
    try:
        _ph_checks.append(
            {
                "timestamp": ts.isoformat(),
                "avg_ph_value": avg_value,
                "samples_required": int(samples_required),
                "samples_available": int(samples_available),
                "reason": reason,
                "readings": list(readings),
            }
        )
    except Exception:
        # Logging must never break the monitoring loop
        return


def get_ph_check_log() -> List[Dict[str, Any]]:
    """
    Return the current log as a list sorted by timestamp ascending.
    The deque is already ordered, but we sort defensively in case of clock drift.
    """
    entries = list(_ph_checks)
    try:
        entries.sort(key=lambda e: e.get("timestamp") or "")
    except Exception:
        pass
    return entries

