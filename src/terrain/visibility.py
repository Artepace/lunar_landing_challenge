"""Apply the LOLA skyline to a paired Sun and Earth observer series."""

import logging
from functools import lru_cache
from pathlib import Path
from threading import Lock

import numpy as np

from .shadow import SUN_RADIUS_DEG, horizon_at, sun_visible_fraction


DEM_PATH = Path(__file__).resolve().parents[2] / 'data' / 'raw' / 'LDEM_80S_80MPP_ADJ.TIF'
_profile_lock = Lock()
logger = logging.getLogger(__name__)


@lru_cache(maxsize=64)
def _profile(latitude, longitude):
    from .horizon_mask import horizon_mask

    azimuth, mask, ground, truncated = horizon_mask(latitude, longitude)
    # NaNs also invalidate interpolation between a complete and incomplete ray.
    return azimuth, np.where(truncated, np.nan, mask), ground


def apply_horizon(samples, *, latitude, longitude, use_lola_frame):
    """Attach a single, consistent horizon basis for the whole window."""
    count = len(samples)
    directions = [sample[body] for body in ('sun', 'earth') for sample in samples]
    azimuths = np.array([direction['azimuthDeg'] for direction in directions])
    elevations = np.array([direction['elevationDeg'] for direction in directions])
    source = 'geometric'
    reason = None
    ground_elevation = None
    horizon = np.zeros_like(elevations)
    if latitude > -80:
        reason = 'outside-coverage'
    elif not use_lola_frame:
        reason = 'frame-unavailable'
    elif not DEM_PATH.is_file():
        reason = 'dem-missing'
    else:
        try:
            # Loading the rasters and computing a profile take substantial memory.
            # Serialize cache misses and reuse each profile across landing times.
            with _profile_lock:
                grid, mask, ground = _profile(latitude, longitude)
            candidate = horizon_at(grid, mask, azimuths)
            if np.isfinite(ground) and np.all(np.isfinite(candidate)):
                source = 'lola'
                ground_elevation = float(ground)
                horizon = candidate
            else:
                reason = 'incomplete-coverage'
        except (ImportError, OSError, ValueError):
            logger.exception('Could not apply the LOLA horizon')
            reason = 'dem-unavailable'

    clearance = elevations - horizon
    solar_fractions = sun_visible_fraction(elevations[:count], horizon[:count])
    # The Sun is visible as soon as its upper limb clears the skyline.
    clearance[:count] += SUN_RADIUS_DEG
    for direction, horizon_deg, clearance_deg in zip(directions, horizon, clearance):
        direction['horizonElevationDeg'] = float(horizon_deg)
        direction['visibilityClearanceDeg'] = float(clearance_deg)
    for sample, fraction in zip(samples, solar_fractions):
        sample['sun']['visibleFraction'] = float(fraction)

    return {'source': source, 'reason': reason, 'groundElevationM': ground_elevation}
