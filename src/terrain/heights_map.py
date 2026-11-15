import numpy as np
import rasterio as rs
import pyproj as pp

from pathlib import Path

# DEM lives in <repo>/data/raw/ (git-ignored; see data/terrain_README.md for download steps)
REPO_ROOT = Path(__file__).resolve().parents[2]
path = REPO_ROOT / 'data' / 'raw' / 'LDEM_80S_80MPP_ADJ.TIF'

with rs.open(path) as src:
    print('Coordinate Reference System:', src.crs) # How flat image is mapped onto moon
    print('Shape:', src.shape) # Grid size (pixels by pixels)
    print('Pixel Size (m):', src.res) # Size of one pixel
    print('Bounds:', src.bounds) # Map edges (pole at 0,0)
    print('Nodata:', src.nodata) # Values used for heights outside valid map area
    map_crs = src.crs
    bounds = src.bounds
    res = src.res[0]
    z = src.read(1, masked=True) # Reads elevation band (masked argument hides 'nodata' pixels)

print()
print('Height Range (m):', float(z.min()), 'to', float(z.max()))

R_moon = 1737400 # (m), from CRS info

# Converting moon lon/lat to (x,y) (m)
map_crs = pp.CRS.from_wkt(map_crs.to_wkt()) # rasterio's CRS description translated to pyproj
geo_crs = map_crs.geodetic_crs # CRS describes moon as a sphere, this pyproj function translates flat map metres to degrees (lon/lat)
to_xy = pp.Transformer.from_crs(geo_crs, map_crs, always_xy=True) # Converting lon/lat to (x,y)

def lonlat_to_xy(lon, lat):
    return to_xy.transform(lon, lat)

# Test site variables
site_lon, site_lat =  129.8, -89.67 # Shackleton Crater as example
sx, sy = lonlat_to_xy(site_lon, site_lat)

if __name__ == '__main__': # Runs only when this file is run directly, not when imported
    import matplotlib as mp
    import matplotlib.pyplot as plt

    print(f'Site map coords: x = {sx/1000:.1f} km, y = {sy/1000:.1f} km')

    # Plot limits
    limit = (bounds.left, bounds.right, bounds.bottom, bounds.top)

    # Reduce data (only for display)
    zs = z[::4, ::4] # only displays every 4th row and column (7600x7600 turns to 1900x1900). Calculation uses full res, z

    # Shading (makes craters and ridges look more 3D, easier to read)
    zs_filled = zs.filled(zs.mean()) # replaces missing values with average (only for shading)
    ls = mp.colors.LightSource(azdeg=315, altdeg=30) # lighting at azimuth, altitude degrees (numbers used are standard convention)
    hs = ls.hillshade(zs_filled, vert_exag=2, dx=320, dy=320) # shading grid itself

    # Drawing (Claude)
    fig, ax = plt.subplots(figsize=(9,9))
    ax.imshow(hs, cmap='gray', extent=limit, origin='upper')
    im = ax.imshow(zs, cmap='terrain', alpha=0.45, extent=limit, origin='upper')
    fig.colorbar(im, ax=ax, label='Height above 1737.4 km sphere (m)', shrink=0.7)

    ax.plot(0, 0, 'w+', ms=12, label='South pole')
    ax.plot(sx, sy, 'r*', ms=14, label='Test site (Shackleton)')

    # Rough ring showing Artemis 3 region (84 degrees south)
    colat = np.radians(6)                         # 84 is 6 degrees from pole
    r84 = 2 * R_moon * np.tan(colat / 2)          # polar stereographic radius
    ax.add_patch(plt.Circle((0, 0), r84, fill=False, ls='--', color='cyan', label='84°S'))

    # Plot
    ax.set_xlabel('x (m)')
    ax.set_ylabel('y (m)')
    ax.set_title('LOLA south pole DEM (80 m)')
    ax.legend(loc='lower left')
    plt.show()
