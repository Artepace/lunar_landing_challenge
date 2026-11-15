import json
import sys
from pathlib import Path

import numpy as np
import rasterio as rs
import matplotlib.pyplot as plt
# Make Person 1's ephemeris folder importable (src/Ephemeris: lunar_sites.py, Position_and_zenith_compilation.py)
REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'src' / 'Ephemeris'))

from lunar_sites import SITES # shared site list (same file the ephemeris script uses)
from heights_map import z, bounds, R_moon, lonlat_to_xy, site_lat, site_lon, res, path

# Height at any point on the map
zf = z.filled(np.nan).astype(np.float64) # masked array into plain float array (missing data = NaN)

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

    lat2 = np.arcsin(np.sin(lat1) * np.cos(delta) + np.cos(lat1) * np.sin(delta) * np.cos(az)) # Spherical law of cosines
    lon2 = lon1 + np.arctan2(np.sin(az) * np.sin(delta) * np.cos(lat1),np.cos(delta) - np.sin(lat1) * np.sin(lat2))

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
    return np.degrees(np.arcsin((v @ up) / np.linalg.norm(v, axis=-1))) # v @ up is the dot product (literally engmaths)



# Far-field fallback: coarse 60S map for rays that run off the edge of the 80S map

FALLBACK_HALF_WIDTH = 500e3 # only load the 60S map within 500 km of the pole (saves memory)

fallback_files = sorted(Path(path).parent.glob('LDEM_60S_240MPP_ADJ*')) # same folder as the 80S file
if fallback_files:
    with rs.open(fallback_files[0]) as src60:
        window = rs.windows.from_bounds(-FALLBACK_HALF_WIDTH, -FALLBACK_HALF_WIDTH,
                                        FALLBACK_HALF_WIDTH, FALLBACK_HALF_WIDTH, src60.transform)
        window = window.round_offsets().round_lengths()
        zf60 = src60.read(1, window=window, masked=True).filled(np.nan).astype(np.float64)
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
    AZ, D = np.meshgrid(az, d, indexing='ij')  # every (direction, distance) pair: 720 x 1500 grid

    # Terrain sample points along every ray
    lat_p, lon_p = destination(lat, lon, AZ, D)          # Part 2: where each sample is
    xp, yp = lonlat_to_xy(lon_p, lat_p)
    h_p = height_with_fallback(np.asarray(xp), np.asarray(yp))   # Part 1: how high each sample is

    # Site height (+ observer height so the site doesn't shadow itself)
    sx, sy = lonlat_to_xy(lon, lat)
    h_ground = height_at(np.array([sx]), np.array([sy]))[0]

    # Part 3: elevation angle of every sample, then the highest per direction
    el = elevation_angle(lat, lon, h_ground + obs_height, lat_p, lon_p, h_p)
    mask = np.nanmax(el, axis=1)                         # the skyline
    truncated = np.isnan(h_p).any(axis=1)                # rays that left both maps

    return az, mask, h_ground, truncated


# Plot the skyline with the band where the Sun can appear
def plot_mask(az, mask, lat, name, ax=None):
    c = 90 - abs(lat)                             # site's angular distance from the pole (deg)
    sun_hi = c * np.cos(np.radians(az)) + 1.54    # approx. highest the Sun can be in each direction
    sun_lo = c * np.cos(np.radians(az)) - 1.54    # approx. lowest

    if ax is None:
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

MASK_FOLDER = REPO_ROOT / 'data' / 'masks' # generated by this script


def site_file_name(name):
    return name.lower().replace(' ', '_') + '.json'


# Save one site's mask so other scripts (shadow.py, the app) can load it without the DEM
def save_mask(name, lat, lon, az, mask, h_ground, truncated, obs_height=2.0):
    MASK_FOLDER.mkdir(exist_ok=True)
    data = {'name': name, 'lat': lat, 'lon': lon,
            'ground_height_m': round(float(h_ground), 1), 'observer_height_m': obs_height,
            'azimuth_deg': az.tolist(),
            'horizon_deg': np.round(mask, 4).tolist(),
            'truncated': truncated.tolist(),
            'dem': [Path(path).name] + ([fallback_files[0].name] if fallback_files else [])}
    with open(MASK_FOLDER / site_file_name(name), 'w') as f:
        json.dump(data, f)


# Load a saved mask (used by shadow.py)
def load_mask(name):
    with open(MASK_FOLDER / site_file_name(name)) as f:
        data = json.load(f)
    return data, np.array(data['azimuth_deg']), np.array(data['horizon_deg'])


if __name__ == '__main__':
    # Validation: Shackleton crater floor should be in permanent shadow (skyline ~20 deg all round)
    az, m, h, tr = horizon_mask(site_lat, site_lon)
    print(f'Shackleton floor check: ground {h:.0f} m, horizon {m.min():.2f} to {m.max():.2f} deg\n')

    # All nine sites: compute, save, plot
    fig, axes = plt.subplots(3, 3, figsize=(15, 9), sharex=True)
    for (name, lon, lat), ax in zip(SITES, axes.flat):
        az, m, h, tr = horizon_mask(lat, lon)
        save_mask(name, lat, lon, az, m, h, tr)
        print(f'{name:<20} ground {h:6.0f} m | horizon {m.min():6.2f} to {m.max():5.2f} deg | truncated {tr.sum()}/{len(az)}')
        plot_mask(az, m, lat, name, ax=ax)
    axes.flat[0].legend(fontsize=7, loc='upper right')
    fig.suptitle('Horizon masks: Artemis south pole candidate sites')
    fig.tight_layout()
    print(f'\nMasks saved to: {MASK_FOLDER}')
    plt.show()
