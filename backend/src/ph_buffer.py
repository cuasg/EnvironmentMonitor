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


def get_last_n_average(count: int = 30, min_readings: int | None = None) -> float | None:
    """
    Return average pH over the last N readings from the rolling buffer.
    Intended for scheduled pH checks that should use a block of recent
    continuous-cycle readings instead of a single sample.
    """
    if count <= 0:
        return None
    # Default minimum: at least half of the requested samples
    if min_readings is None:
        min_readings = max(1, count // 2)

    if not _buffer:
        return None

    # Take the latest N readings regardless of exact timestamps
    recent_values = [v for _, v in list(_buffer)[-count:]]
    if len(recent_values) < min_readings:
        return None

    return round(sum(recent_values) / len(recent_values), 1)


def clear_buffer() -> None:
    """Clear all stored pH readings from the rolling buffer."""
    _buffer.clear()


def buffer_size() -> int:
    """Return how many pH samples are currently stored in the buffer."""
    return len(_buffer)
