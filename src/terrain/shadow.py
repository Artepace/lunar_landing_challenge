import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

# Make Person 1's ephemeris folder importable (src/Ephemeris: lunar_sites.py, Position_and_zenith_compilation.py)
REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'src' / 'Ephemeris'))

from Position_and_zenith_compilation import get_table, read_time # Person 1's Horizons code


SUN_RADIUS_DEG = 0.267 # apparent radius of the Sun's disc seen from the Moon

# Settings: date range and time step (UTC)
START = '2026-11-01 00:00'
STOP = '2026-12-01 00:00'
STEP_MINUTES = 30

# Horizon masks saved by horizon_mask.py (loading these avoids loading the DEMs again)
MASK_FOLDER = REPO_ROOT / 'data' / 'masks' # written by horizon_mask.py


# Sun azimuth/elevation at a site, fetched with Person 1's Horizons code (get_table, read_time)
def sun_positions(lat, lon, start, stop, step_minutes):
    settings = {'COMMAND': '10',                                  # 10 = the Sun
                'CENTER': 'coord@301', 'COORD_TYPE': 'GEODETIC',  # observer on the Moon (301)
                'SITE_COORD': f'{lon},{lat},0',
                'START_TIME': start, 'STOP_TIME': stop, 'STEP_SIZE': f'{step_minutes} min',
                'TIME_TYPE': 'UT', 'CAL_TYPE': 'GREGORIAN',
                'CSV_FORMAT': 'YES', 'MAKE_EPHEM': 'YES', 'OBJ_DATA': 'NO',
                'EPHEM_TYPE': 'OBSERVER', 'QUANTITIES': '4',           # 4 = azimuth & elevation
                'APPARENT': 'AIRLESS',                                # no atmosphere = no refraction
                'TIME_DIGITS': 'MINUTES', 'CAL_FORMAT': 'CAL',
                'ELEV_CUT': '-90', 'SKIP_DAYLT': 'NO'}                # keep rows when the Sun is down
    header, rows = get_table(settings)                                # Person 1: request + validation
    az_col = header.index('Azi_(a-app)')
    el_col = header.index('Elev_(a-app)')
    times = np.array([read_time(r[0]) for r in rows])                 # Person 1: JPL date parsing
    az = np.array([float(r[az_col]) for r in rows]) % 360             # clockwise from local north
    el = np.array([float(r[el_col]) for r in rows])
    return times, az, el


# Read every saved horizon mask (one JSON file per site)
def load_all_masks():
    files = sorted(MASK_FOLDER.glob('*.json'))
    if not files:
        raise FileNotFoundError(f'No masks in {MASK_FOLDER}. Run horizon_mask.py first.')
    masks = []
    for f in files:
        with open(f) as fh:
            masks.append(json.load(fh))
    return masks


# Terrain elevation in any direction (looks up the mask between its 0.5 deg steps)
def horizon_at(az_grid, mask, az_query):
    return np.interp(az_query, az_grid, mask, period=360) # period=360 so 359.9 deg wraps to 0 deg


# Fraction of the Sun's disc above the terrain (0 = hidden, 1 = fully visible)
def sun_visible_fraction(sun_el, horizon_el):
    x = np.clip((sun_el - horizon_el) / SUN_RADIUS_DEG, -1, 1) # disc centre above the ridge, in Sun radii
    return 1 - (np.arccos(x) - x * np.sqrt(1 - x**2)) / np.pi  # area of a circle above a straight line


# Longest run of consecutive True values: (length in hours, start index, end index)
def longest_run(flags, step_hours):
    longest = current = 0
    best_start = best_end = None
    for i, f in enumerate(flags):
        current = current + 1 if f else 0
        if current > longest:
            longest = current
            best_end = i
            best_start = i - current + 1
    return longest * step_hours, best_start, best_end


# Hours from the first timestep until the state changes (sunset if lit, sunrise if dark)
def hours_until_change(lit, step_hours):
    changes = np.nonzero(lit != lit[0])[0]
    return changes[0] * step_hours if len(changes) else None # None = no change in the date range


# Everything the power assessment needs for one site
def analyse_site(m):
    name, lat, lon = m['name'], m['lat'], m['lon']
    az, mask = np.array(m['azimuth_deg']), np.array(m['horizon_deg'])
    t, s_az, s_el = sun_positions(lat, lon, START, STOP, STEP_MINUTES)
    hz = horizon_at(az, mask, s_az)             # terrain height in the Sun's direction, at every time
    frac = sun_visible_fraction(s_el, hz)       # how much of the Sun is visible, at every time
    lit = frac > 0
    step_h = STEP_MINUTES / 60
    return {'name': name, 'times': t, 'sun_az': s_az, 'sun_el': s_el, 'horizon_el': hz,
            'fraction': frac, 'lit': lit, 'az': az, 'mask': mask,
            'pct_lit': 100 * lit.mean(),
            'pct_full': 100 * (frac >= 0.999).mean(),
            'longest_shadow': longest_run(~lit, step_h),   # (hours, start index, end index)
            'longest_sun_h': longest_run(lit, step_h)[0],
            'lit_at_start': bool(lit[0]),
            'hours_to_change': hours_until_change(lit, step_h)}


# Lit vs shadow over time, drawn on a given set of axes
def plot_timeline(r, ax):
    lit = r['lit']
    ax.plot(r['times'], r['sun_el'], color='orange', lw=1, label='Sun elevation')
    ax.plot(r['times'], r['horizon_el'], color='dimgray', lw=1, label="Terrain in the Sun's direction")
    ax.fill_between(r['times'], -90, 90, where=~lit, color='tab:blue', alpha=0.15, label='In shadow')
    ax.set_ylim(min(r['horizon_el'].min(), r['sun_el'].min()) - 0.5, max(r['horizon_el'].max(), r['sun_el'].max()) + 0.5)
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%d %b'))
    ax.tick_params(axis='x', labelsize=8)
    ax.set_ylabel('Elevation (°)', fontsize=8)
    ax.set_title(f"{r['name']}  ({r['pct_lit']:.0f}% lit)", fontsize=10)


# Figure: lit vs shadow timeline for every site
def plot_all_timelines(results):
    fig, axes = plt.subplots(3, 3, figsize=(16, 10), sharex=True)
    for r, ax in zip(results.values(), axes.flat):
        plot_timeline(r, ax)
    axes.flat[0].legend(fontsize=7, loc='upper right')
    fig.suptitle(f'Lit vs shadow over time, {START[:10]} to {STOP[:10]} (UTC)')
    fig.tight_layout()


# Figure: table of every site's longest continuous shadow
def plot_shadow_table(results):
    rows = []
    for r in sorted(results.values(), key=lambda r: r['longest_shadow'][0]): # shortest shadow first
        hours, i0, i1 = r['longest_shadow']
        if i0 is None:
            rows.append([r['name'], f"{r['pct_lit']:.0f}", '0', '0', '-', '-'])
            continue
        t_start = r['times'][i0].strftime('%d %b %H:%M')
        t_end = (r['times'][i1] + timedelta(minutes=STEP_MINUTES)).strftime('%d %b %H:%M')
        rows.append([r['name'], f"{r['pct_lit']:.0f}", f'{hours:.1f}', f'{hours / 24:.1f}', t_start, t_end])

    fig, ax = plt.subplots(figsize=(11, 4))
    ax.axis('off')
    table = ax.table(cellText=rows,
                     colLabels=['Site', 'Lit (%)', 'Longest shadow (h)', 'Longest shadow (days)',
                                'Shadow starts (UTC)', 'Shadow ends (UTC)'],
                     loc='center', cellLoc='center')
    table.auto_set_font_size(False)
    table.set_fontsize(9)
    table.scale(1, 1.6)
    for col in range(6):
        table[0, col].set_facecolor('#d9e2f3')
        table[0, col].set_text_props(weight='bold')
    ax.set_title(f'Longest continuous shadow per site, {START[:10]} to {STOP[:10]} (UTC)', pad=12)
    ax.text(0.5, 0.02, 'A shadow that starts at the first time step or ends at the last may continue beyond the date range.',
            transform=ax.transAxes, ha='center', fontsize=8, style='italic')
    fig.tight_layout()


if __name__ == '__main__':
    print(f'Sunlight summary, {START} to {STOP} UTC, {STEP_MINUTES} min steps\n')
    print(f"{'Site':<20} {'Lit %':>6} {'Full %':>7} {'Longest shadow':>15} {'Longest sun':>12}  At start")
    results = {}
    for m in load_all_masks():
        name = m['name']
        r = analyse_site(m)
        results[name] = r
        if r['hours_to_change'] is None:
            start_note = 'lit, no sunset in range' if r['lit_at_start'] else 'dark, no sunrise in range'
        elif r['lit_at_start']:
            start_note = f"lit, sunset in {r['hours_to_change']:.1f} h"
        else:
            start_note = f"dark, sunrise in {r['hours_to_change']:.1f} h"
        print(f"{name:<20} {r['pct_lit']:6.0f} {r['pct_full']:7.0f} {r['longest_shadow'][0]:13.1f} h {r['longest_sun_h']:10.1f} h  {start_note}")

    plot_all_timelines(results)
    plot_shadow_table(results)
    plt.show()
