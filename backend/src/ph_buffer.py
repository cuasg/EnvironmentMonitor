"""
In-memory rolling buffer for pH readings. Used by ph_monitoring to average recent
readings from continuous_monitoring instead of doing 60 separate sensor reads.
"""
from collections import deque
from time import time

# Store (timestamp, ph_value) - time-based so it works with any sensor interval
_buffer = deque(maxlen=500)  # ~40 min at 5s intervals; prevents unbounded growth


def add_reading(ph_value: float) -> None:
    """Call from continuous_monitoring when we have a new pH reading."""
    if ph_value is not None and 1.0 <= ph_value <= 14.0:
        _buffer.append((time(), ph_value))


def get_average(minutes: float = 5.0, min_readings: int = 6) -> float | None:
    """
    Return average pH over the last N minutes, or None if insufficient data.
    min_readings avoids acting on too few samples (e.g. right after startup).
    """
    cutoff = time() - (minutes * 60)
    recent = [v for t, v in _buffer if t >= cutoff]
    if len(recent) < min_readings:
        return None
    return round(sum(recent) / len(recent), 1)
