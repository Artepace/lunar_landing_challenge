"""Run from the repository root: python -m uvicorn src.Ephemeris.api:app."""

import asyncio
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .Position_and_zenith_compilation import (
    HorizonsError,
    HorizonsTimeout,
    calculate_visibility,
    utc_text,
)
from .lunar_sites import SITES
from ..terrain.surface import surface_mesh
from ..terrain.visibility import apply_horizon


STEP_MINUTES = 15
WINDOW_HOURS = 72
API_TIMEOUT_SECONDS = 65.0
FRONTEND_DIST = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
logger = logging.getLogger(__name__)


def read_landing_time(value):
    """Accept a UTC ISO timestamp only when it falls on a whole minute."""
    pattern = r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.(\d+))?)?(?:Z|\+00:00)"
    match = re.fullmatch(pattern, value)
    if match is None:
        raise ValueError("Use an ISO 8601 UTC timestamp ending in Z or +00:00.")
    # Check every fractional digit, including digits Python might truncate.
    if match.group(1) and any(digit != "0" for digit in match.group(1)):
        raise ValueError("The landing time must fall on a whole minute.")
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if stamp.second or stamp.microsecond:
            raise ValueError("The landing time must fall on a whole minute.")
        stamp + timedelta(hours=WINDOW_HOURS)  # Reject a window beyond year 9999.
    except (ValueError, OverflowError) as error:
        raise ValueError("Use a valid UTC date and time aligned to a whole minute.") from error
    return stamp.astimezone(timezone.utc)


class VisibilityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Strict numeric fields reject strings and booleans as well as NaN/infinity.
    latitude: Annotated[float, Field(strict=True, ge=-90, le=90, allow_inf_nan=False)]
    longitude: Annotated[float, Field(strict=True, ge=-180, le=180, allow_inf_nan=False)]
    landingTimeUtc: Annotated[str, Field(strict=True)]

    @field_validator("landingTimeUtc")
    @classmethod
    def check_landing_time(cls, value):
        return utc_text(read_landing_time(value))


class Direction(BaseModel):
    azimuthDeg: Annotated[float, Field(ge=0, lt=360, allow_inf_nan=False)]
    elevationDeg: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
    horizonElevationDeg: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
    visibilityClearanceDeg: Annotated[float, Field(allow_inf_nan=False)]


class SunDirection(Direction):
    visibleFraction: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class VisibilitySample(BaseModel):
    utc: str
    sun: SunDirection
    earth: Direction


class Horizon(BaseModel):
    source: Literal['geometric', 'lola']
    reason: Literal['outside-coverage', 'frame-unavailable', 'dem-missing',
                    'incomplete-coverage', 'dem-unavailable'] | None
    groundElevationM: float | None


class VisibilityResponse(BaseModel):
    landingTimeUtc: str
    stepMinutes: int
    samples: list[VisibilitySample] = Field(min_length=289, max_length=289)
    horizon: Horizon


class Site(BaseModel):
    name: str
    latitude: float
    longitude: float


def _visibility_with_horizon(request, start, stop):
    samples = calculate_visibility(
        latitude=request.latitude, longitude=request.longitude,
        start_utc=start, stop_utc=stop, step_minutes=STEP_MINUTES,
    )
    horizon = apply_horizon(
        samples, latitude=request.latitude, longitude=request.longitude,
        use_lola_frame=1550 <= start.year <= stop.year <= 2650,
    )
    return {"landingTimeUtc": utc_text(start), "stepMinutes": STEP_MINUTES,
            "samples": samples, "horizon": horizon}


def create_app():
    app = FastAPI(title="SELENE visibility API", version="1.0.0")

    # Same-origin requests need no CORS settings. For a separate React server,
    # set SELENE_CORS_ORIGINS to its origin (or comma-separated origins).
    origins = [origin.strip() for origin in os.getenv("SELENE_CORS_ORIGINS", "").split(",")
               if origin.strip()]
    if origins:
        app.add_middleware(
            CORSMiddleware, allow_origins=origins,
            allow_methods=["GET", "POST"], allow_headers=["Content-Type"],
        )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        # Do not echo arbitrary input. This also makes invalid NaN/infinity
        # values safe to report in JSON rather than causing a server error.
        return JSONResponse(status_code=422, content={"detail": [
            {"loc": list(item["loc"]), "msg": item["msg"], "type": item["type"]}
            for item in error.errors()
        ]})

    @app.get("/api/sites", response_model=list[Site])
    def sites():
        return [{"name": name, "latitude": latitude, "longitude": longitude}
                for name, longitude, latitude in SITES]

    @app.get("/api/terrain", response_class=Response)
    def terrain(latitude: Annotated[float, Query(ge=-90, le=90, allow_inf_nan=False)],
                longitude: Annotated[float, Query(ge=-180, le=180, allow_inf_nan=False)]):
        if latitude > -80:
            raise HTTPException(status_code=404, detail="This site is outside the LOLA south-pole coverage.")
        try:
            mesh = surface_mesh(latitude, longitude)
        except FileNotFoundError as error:
            raise HTTPException(status_code=503, detail="The LOLA elevation maps are unavailable.") from error
        except (ImportError, OSError, ValueError) as error:
            logger.exception("Could not build the LOLA surface")
            raise HTTPException(status_code=503, detail="The LOLA terrain could not be loaded.") from error
        if mesh is None:
            raise HTTPException(status_code=404, detail="The LOLA maps do not cover this site's full terrain view.")
        return Response(mesh, media_type="application/octet-stream",
                        headers={"Cache-Control": "public, max-age=3600"})

    @app.post("/api/visibility", response_model=VisibilityResponse)
    async def visibility(request: VisibilityRequest):
        start = read_landing_time(request.landingTimeUtc)
        stop = start + timedelta(hours=WINDOW_HOURS)
        try:
            # The existing client uses blocking HTTP. Run it in a worker so
            # it does not block other API requests, and cap the overall wait.
            return await asyncio.wait_for(
                asyncio.to_thread(_visibility_with_horizon, request, start, stop),
                timeout=API_TIMEOUT_SECONDS,
            )
        except HorizonsTimeout as error:
            raise HTTPException(status_code=504, detail="JPL Horizons timed out. Please retry.") from error
        except (asyncio.TimeoutError, TimeoutError) as error:
            raise HTTPException(status_code=504, detail="The visibility calculation timed out. Please retry.") from error
        except HorizonsError as error:
            raise HTTPException(status_code=502, detail="JPL Horizons returned unavailable or invalid data.") from error

    if (FRONTEND_DIST / 'index.html').is_file():
        app.mount('/', StaticFiles(directory=FRONTEND_DIST, html=True), name='frontend')

    return app


app = create_app()
