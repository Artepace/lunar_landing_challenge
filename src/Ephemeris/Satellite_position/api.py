"""API routes for using an Earth satellite as the lander's communications link.

GET  /api/satellites      lists the satellites offered in satellite_settings.py.
POST /api/satellite-link  takes a landing site, landing time and one catalogue
                          ID, and returns the satellite's direction from the
                          site over the 72-hour window plus one orbit to draw.
"""

import asyncio
import logging
import os
import tempfile
from datetime import timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Annotated

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import satellite_settings as settings

STEP_MINUTES = 15
WINDOW_HOURS = 72
ORBIT_POINTS = 180
TIMEOUT_SECONDS = 65

logger = logging.getLogger(__name__)
router = APIRouter()
_lock = Lock()
_model = None


class SatelliteOption(BaseModel):
    id: int
    name: str


class SatelliteLinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The lunar frame has no defined north exactly at a pole.
    latitude: Annotated[float, Field(strict=True, gt=-90, lt=90, allow_inf_nan=False)]
    longitude: Annotated[float, Field(strict=True, ge=-180, le=180, allow_inf_nan=False)]
    landingTimeUtc: str
    satelliteId: Annotated[int, Field(strict=True)]

    @field_validator("satelliteId")
    @classmethod
    def check_satellite(cls, value):
        if value not in {catalog_id for catalog_id, _ in settings.AVAILABLE_SATELLITES}:
            raise ValueError("Choose a satellite from /api/satellites.")
        return value


class SatelliteSample(BaseModel):
    utc: str
    azimuthDeg: float
    elevationDeg: float
    access: bool


class SatelliteInfo(SatelliteOption):
    epochUtc: str


class Orbit(BaseModel):
    periodMinutes: float
    # Earth-centred, ICRF-aligned km, one revolution starting at the landing time.
    positionsKm: list[tuple[float, float, float]]
    # Greenwich apparent sidereal angle at the landing time, to orient Earth.
    earthRotationDeg: float
    moonDirection: tuple[float, float, float]


class SatelliteLinkResponse(BaseModel):
    satellite: SatelliteInfo
    landingTimeUtc: str
    stepMinutes: int
    samples: list[SatelliteSample]
    accessFraction: float
    orbit: Orbit


class EpochTooFar(RuntimeError):
    pass


def _cache_folder():
    """Use the repository cache when writable; serverless hosts only allow temp."""
    folder = Path(settings.CACHE_FOLDER)
    try:
        folder.mkdir(parents=True, exist_ok=True)
        if os.access(folder, os.W_OK):
            return folder
    except OSError:
        pass
    return Path(tempfile.gettempdir()) / "khonsu_satellite_cache"


def _satellite_link(latitude, longitude, start, satellite_id):
    # Skyfield and the JPL files are only loaded when a satellite is requested.
    global _model
    from . import Satellite_position_and_angles as sat

    cache = _cache_folder()
    record, _ = sat.download_orbit(satellite_id, cache)
    timestamps = [start + timedelta(minutes=STEP_MINUTES * index)
                  for index in range(WINDOW_HOURS * 60 // STEP_MINUTES + 1)]
    with _lock:
        if _model is None:
            _model = sat.LunarModel(cache)
        model = _model
        satellite = sat.EarthSatellite.from_omm(model.timescale, record)
        try:
            epoch, _ = sat.check_epoch(satellite, timestamps, settings.MAX_EPOCH_DISTANCE_DAYS)
        except sat.SatelliteDataError as error:
            raise EpochTooFar(str(error)) from error
        pair = sat.calculate_pair(model, satellite, ("site", longitude, latitude), timestamps,
                                  settings.HEIGHT_KM, settings.MIN_ELEVATION_DEG)

        period = 1440.0 / float(record["MEAN_MOTION"])
        orbit_times = model.timescale.from_datetimes(
            [start + timedelta(minutes=period * index / ORBIT_POINTS) for index in range(ORBIT_POINTS + 1)])
        positions = satellite.at(orbit_times).position.km.T
        landing = model.timescale.from_datetime(start)
        moon = (model.moon - model.earth).at(landing).position.km
        rotation = float(landing.gast) * 15.0 % 360.0

    if not np.all(np.isfinite(positions)):
        raise sat.SatelliteDataError("Invalid orbit positions.")
    samples = [{"utc": sat.utc_text(stamp), "azimuthDeg": float(azimuth),
                "elevationDeg": float(90.0 - zenith), "access": bool(access)}
               for stamp, azimuth, zenith, access
               in zip(timestamps, pair["azimuth"], pair["zenith"], pair["access"])]
    return {
        "satellite": {"id": satellite_id, "name": record["OBJECT_NAME"], "epochUtc": sat.utc_text(epoch)},
        "landingTimeUtc": sat.utc_text(start), "stepMinutes": STEP_MINUTES, "samples": samples,
        "accessFraction": float(np.mean(pair["access"])),
        "orbit": {"periodMinutes": period,
                  "positionsKm": [tuple(round(float(value), 2) for value in row) for row in positions],
                  "earthRotationDeg": rotation,
                  "moonDirection": tuple(float(value) for value in moon / np.linalg.norm(moon))},
    }


@router.get("/api/satellites", response_model=list[SatelliteOption])
def satellites():
    return [{"id": catalog_id, "name": name} for catalog_id, name in settings.AVAILABLE_SATELLITES]


@router.post("/api/satellite-link", response_model=SatelliteLinkResponse)
async def satellite_link(request: SatelliteLinkRequest):
    from ..Earth_sun_Position.api import read_landing_time

    try:
        start = read_landing_time(request.landingTimeUtc).astimezone(timezone.utc)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_satellite_link, request.latitude, request.longitude, start, request.satelliteId),
            timeout=TIMEOUT_SECONDS,
        )
    except EpochTooFar as error:
        raise HTTPException(
            status_code=409,
            detail=("Current orbital data only covers landing dates within "
                    f"{settings.MAX_EPOCH_DISTANCE_DAYS:g} days of today. Choose a nearer landing date."),
        ) from error
    except (asyncio.TimeoutError, TimeoutError) as error:
        raise HTTPException(status_code=504, detail="The satellite calculation timed out. Please retry.") from error
    except ImportError as error:
        logger.exception("Skyfield is not installed")
        raise HTTPException(status_code=503, detail="Satellite calculations are unavailable on this server.") from error
    except Exception as error:  # SatelliteDataError, download and SGP4 failures.
        logger.exception("Satellite link calculation failed")
        raise HTTPException(status_code=502, detail="Satellite orbit data is unavailable or invalid.") from error
