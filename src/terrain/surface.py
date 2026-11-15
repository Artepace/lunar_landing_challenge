"""Build a curved, site-centered ground mesh from the LOLA elevation maps."""

import struct
from functools import lru_cache

import numpy as np

from .visibility import DEM_PATH


@lru_cache(maxsize=12)
def surface_mesh(latitude, longitude):
    if not DEM_PATH.is_file():
        raise FileNotFoundError(DEM_PATH)

    # Loading the rasters is deferred until a terrain request needs them.
    from .horizon_mask import R_moon, ground_height, sample_ray_points

    ground = ground_height(latitude, longitude)
    if not np.isfinite(ground):
        return None

    azimuths = np.arange(360.0)
    distances = np.concatenate((
        [10, 20, 40, 60],
        np.arange(80, 8_001, 80),
        np.geomspace(8_000, 150_000, 161)[1:],
    ))
    _, _, heights = sample_ray_points(latitude, longitude, azimuths, distances)
    if not np.all(np.isfinite(heights)):
        return None

    # Convert from lunar radius to (east, up, south) in kilometers. The
    # cosine term retains lunar curvature below the observer's tangent plane.
    radius = R_moon + heights.T
    arc = distances[:, None] / R_moon
    bearing = np.radians(azimuths)
    horizontal = radius * np.sin(arc)
    vertices = np.empty((len(distances), len(azimuths), 3), dtype='<f4')
    vertices[..., 0] = horizontal * np.sin(bearing) / 1_000
    vertices[..., 1] = (radius * np.cos(arc) - (R_moon + ground)) / 1_000
    vertices[..., 2] = -horizontal * np.cos(bearing) / 1_000

    # Ring count, bearings per ring, center vertex, then ring vertices.
    return (struct.pack('<IIfff', len(distances), len(azimuths), 0, 0, 0)
            + vertices.tobytes())
