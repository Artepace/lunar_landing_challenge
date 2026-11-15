"""Edit this file to choose satellites, dates, and output settings."""

from pathlib import Path

# A NORAD catalogue number identifies a real Earth-orbiting object.
# 25544 is the ISS, used only as a geometry example, not as a lunar relay.
# Add more catalogue numbers to calculate several satellites in one run.
SATELLITE_IDS = [25544]

# None means start at the current UTC minute. To choose a time instead, use
# a string such as "2026-11-15 12:00". Current orbital data is for nearby dates,
# not for predicting a whole year. Historical dates need historical elements.
START_TIME = None
DURATION_HOURS = 24
STEP_SECONDS = 60

# Import every point from lunar_sites.py, or select names from that file here.
# For example: SITE_NAMES = ["Malapert Massif"]
SITE_NAMES = None

HEIGHT_KM = 0.0             # Height above the spherical lunar reference surface.
MIN_ELEVATION_DEG = 0.0    # Geometric elevation required for an access estimate.

# This is a screening limit, not a statement of prediction accuracy.
# The script rejects runs farther than 7 days from an element set's epoch.
MAX_EPOCH_DISTANCE_DAYS = 7.0

# Paths are based on this script's location, not your terminal's current folder.
PROJECT_FOLDER = Path(__file__).resolve().parents[2]
CACHE_FOLDER = PROJECT_FOLDER / "data" / "satellite_cache"
OUTPUT_FOLDER = PROJECT_FOLDER / "data" / "satellite_results"
