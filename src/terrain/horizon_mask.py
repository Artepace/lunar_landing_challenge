from pathlib import Path

import numpy as np
import rasterio as rs
if __package__:
    from ..Ephemeris.lunar_sites import SITES
    from .heights_map import z, bounds, R_moon, lonlat_to_xy, site_lat, site_lon, res, path
else:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'Ephemeris'))
    from lunar_sites import SITES
    from heights_map import z, bounds, R_moon, lonlat_to_xy, site_lat, site_lon, res, path

# Height at any point on the map
zf = z.astype(np.float32, copy=False).filled(np.nan)

# How high the ground is at any point (any DEM grid; defaults to the 80S map)
def height_at(x, y, grid=zf, left=bounds.left, top=bounds.top, cell=res):
    # Convention: columns count from left to right, rows from top to bottom
    # Mapping metres to pixels
    col = (x - left) / cell - 0.5 # -0.5 to count from pixel centre
    row = (top - y) / cell - 0.5

    # round down to get pixel just to the top and left of a point
    c0 = np.floor(col).astype(int)
    r0 = np.floor(row).astype(int)

    # Distance (as a fraction) from previous pixel to exact point position
    fc = col - c0
    fr = row - r0

    # Crash mitigation from off map points and fixing indices
    inside = (c0 >= 0) & (r0 >= 0) & (c0 < grid.shape[1] - 1) & (r0 < grid.shape[0] - 1)
    c0 = np.clip(c0, 0, grid.shape[1] - 2)
    r0 = np.clip(r0, 0, grid.shape[0] - 2)

    '''
    Bilinear interpolation: Take a weighted average of height across the 4 pixels around a
    specific point (c0, r0, c0+1, r0+1). The weight is decided by how close the point is to
    it, i.e. if the point is on an exact pixel then that pixel's height is taken as is, and
    a point exactly in the middle of the 4 pixels would be the normal average. This allows for
    a smooth surface instead of heights at 80m steps. This could be further refined by using
    higher resolution datasets.
    '''

    h = (grid[r0, c0]         * (1 - fc) * (1 - fr) +
         grid[r0, c0 + 1]     * fc       * (1 - fr) +
         grid[r0 + 1, c0]     * (1 - fc) * fr +
         grid[r0 + 1, c0 + 1] * fc       * fr)

    return np.where(inside, h, np.nan) # NaN if off the map


# Point reached by travelling along a geodesic in a given direction
def destination(lat_deg, lon_deg, az_deg, dist_m):
    '''
    If starting at a point (lat,lon), travelling dist_m in the direction az_deg will return
    a new end point (lat,lon). dist_m is along a geodesic.
    '''
    lat1 = np.radians(lat_deg)
    lon1 = np.radians(lon_deg)
    az = np.radians(az_deg)
    delta = dist_m / R_moon # angular distance travelled = arc length / radius

    # Move along the initial tangent in Cartesian coordinates. This also keeps
    # the azimuth convention defined at a pole by the observer's longitude.
    up = unit_vector(lat_deg, lon_deg)
    north = np.array([-np.sin(lat1) * np.cos(lon1), -np.sin(lat1) * np.sin(lon1), np.cos(lat1)])
    east = np.array([-np.sin(lon1), np.cos(lon1), 0.0])
    bearing = np.cos(az)[..., None] * north + np.sin(az)[..., None] * east
    point = np.cos(delta)[..., None] * up + np.sin(delta)[..., None] * bearing
    lat2 = np.arctan2(point[..., 2], np.hypot(point[..., 0], point[..., 1]))
    lon2 = np.arctan2(point[..., 1], point[..., 0])
    return np.degrees(lat2), np.degrees(lon2)

# Unit vector pointing from the moon's centre to a point at (lat,lon)
def unit_vector(lat_deg, lon_deg):
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    return np.stack([np.cos(lat) * np.cos(lon), # x: towards lat 0, lon 0
                     np.cos(lat) * np.sin(lon),       # y: towards lat 0, lon 90E
                     np.sin(lat)], axis=-1)           # z: towards the north pole

# The big bad: Elevation angle measured from line tangent to site to terrain points
def elevation_angle(site_lat, site_lon, site_h, pt_lat, pt_lon, pt_h):
    S = (R_moon + site_h) * unit_vector(site_lat, site_lon)                   # site position
    up = S / np.linalg.norm(S)                                                # local vertical at site
    P = (R_moon + np.asarray(pt_h))[..., None] * unit_vector(pt_lat, pt_lon)  # terrain positions
    v = P - S                                                                 # line(s) of sight
    sine = (v @ up) / np.linalg.norm(v, axis=-1)
    return np.degrees(np.arcsin(np.clip(sine, -1, 1)))



# Far-field fallback: coarse 60S map for rays that run off the edge of the 80S map

FALLBACK_HALF_WIDTH = 500e3 # only load the 60S map within 500 km of the pole (saves memory)

fallback_files = sorted(Path(path).parent.glob('LDEM_60S_240MPP_ADJ*')) # same folder as the 80S file
if fallback_files:
    with rs.open(fallback_files[0]) as src60:
        window = rs.windows.from_bounds(-FALLBACK_HALF_WIDTH, -FALLBACK_HALF_WIDTH,
                                        FALLBACK_HALF_WIDTH, FALLBACK_HALF_WIDTH, src60.transform)
        window = window.round_offsets().round_lengths()
        zf60 = src60.read(1, window=window, masked=True, out_dtype='float32').filled(np.nan)
        b60 = rs.windows.bounds(window, src60.transform) # (left, bottom, right, top) of the loaded part
        left60, top60, res60 = b60[0], b60[3], src60.res[0]
else:
    zf60 = None
    print('WARNING: 60S fallback DEM not found next to the 80S file; outer sites will be truncated.')


# Height from the 80S map, filling any off-map points from the 60S map
def height_with_fallback(x, y):
    h = height_at(x, y)                                        # 80S (fine)
    if zf60 is not None:
        missing = np.isnan(h)
        if missing.any():
            h[missing] = height_at(x[missing], y[missing],     # 60S (coarse) only where needed
                                   grid=zf60, left=left60, top=top60, cell=res60)
    return h


def ground_height(lat, lon):
    x, y = lonlat_to_xy(lon, lat)
    return height_at(np.array([x]), np.array([y]))[0]


def sample_ray_points(lat, lon, azimuths, distances):
    az, distance = np.meshgrid(azimuths, distances, indexing='ij')
    point_lat, point_lon = destination(lat, lon, az, distance)
    x, y = lonlat_to_xy(point_lon, point_lat)
    heights = height_with_fallback(np.asarray(x), np.asarray(y))
    return point_lat, point_lon, heights


# The big bad: skyline around a site, showing highest terrain elevation angles in every direction
def horizon_mask(lat, lon, obs_height=2.0, az_step=0.5, max_dist=150e3, n_samples=1500):
    """
    Returns:
      az        - azimuths (deg, clockwise from local north)
      mask      - horizon elevation (deg) in each azimuth
      h_ground  - terrain height at the site (m, relative to the 1737.4 km sphere)
      truncated - True where a ray ran off BOTH maps (mask may be incomplete there)
    """
    az = np.arange(0, 360, az_step)
    d = np.geomspace(res, max_dist, n_samples)  # distances: dense near the site, sparse far away
    h_ground = ground_height(lat, lon)
    if not np.isfinite(h_ground):
        return az, np.full_like(az, np.nan), h_ground, np.ones_like(az, dtype=bool)

    lat_p, lon_p, h_p = sample_ray_points(lat, lon, az, d)

    # Part 3: elevation angle of every sample, then the highest per direction
    el = elevation_angle(lat, lon, h_ground + obs_height, lat_p, lon_p, h_p)
    mask = np.fmax.reduce(el, axis=1)                    # the skyline
    truncated = np.isnan(h_p).any(axis=1)                # rays that left both maps

    return az, mask, h_ground, truncated


# Plot the skyline with the band where the Sun can appear
def plot_mask(az, mask, lat, name, ax=None):
    c = 90 - abs(lat)                             # site's angular distance from the pole (deg)
    sun_hi = c * np.cos(np.radians(az)) + 1.54    # approx. highest the Sun can be in each direction
    sun_lo = c * np.cos(np.radians(az)) - 1.54    # approx. lowest

    if ax is None:
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(figsize=(11, 4))
    ax.fill_between(az, sun_lo, sun_hi, color='gold', alpha=0.35, label="Sun's possible positions (approx.)")
    ax.fill_between(az, mask, min(mask.min(), sun_lo.min()) - 2, color='dimgray', label='Terrain')
    ax.axhline(0, color='k', lw=0.8, ls=':', label='Flat horizon (0°)')
    ax.set_xlim(0, 360)
    ax.set_xticks([0, 90, 180, 270, 360], ['N', 'E', 'S', 'W', 'N'])
    ax.set_ylabel('Elevation (°)')
    ax.set_title(name, fontsize=10)
    return ax


# Landing sites: SITES (name, east longitude, latitude) is imported from Person 1's lunar_sites.py

if __name__ == '__main__':
    import matplotlib.pyplot as plt

    # Validation: Shackleton crater floor should be in permanent shadow (skyline ~20 deg all round)
    az, m, h, tr = horizon_mask(site_lat, site_lon)
    print(f'Shackleton floor check: ground {h:.0f} m, horizon {m.min():.2f} to {m.max():.2f} deg\n')

    # All nine sites: compute and plot
    fig, axes = plt.subplots(3, 3, figsize=(15, 9), sharex=True)
    for (name, lon, lat), ax in zip(SITES, axes.flat):
        az, m, h, tr = horizon_mask(lat, lon)
        print(f'{name:<20} ground {h:6.0f} m | horizon {m.min():6.2f} to {m.max():5.2f} deg | truncated {tr.sum()}/{len(az)}')
        plot_mask(az, m, lat, name, ax=ax)
    axes.flat[0].legend(fontsize=7, loc='upper right')
    fig.suptitle('Horizon masks: Artemis south pole candidate sites')
    fig.tight_layout()
    plt.show()
