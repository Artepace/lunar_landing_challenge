"""Offline checks for the satellite communications-link routes."""

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from src.Ephemeris.Earth_sun_Position.api import create_app
from src.Ephemeris.Satellite_position import api as satellite_api
from src.Ephemeris.Satellite_position import satellite_settings

BODY = {"latitude": -85.99, "longitude": -0.125,
        "landingTimeUtc": "2026-11-15T14:00:00Z", "satelliteId": 25544}
LINK = {
    "satellite": {"id": 25544, "name": "ISS (ZARYA)", "epochUtc": "2026-11-15T04:56:48Z"},
    "landingTimeUtc": "2026-11-15T14:00:00Z", "stepMinutes": 15,
    "samples": [{"utc": "2026-11-15T14:00:00Z", "azimuthDeg": 357.5, "elevationDeg": 1.5, "access": True}],
    "accessFraction": 1.0,
    "orbit": {"periodMinutes": 92.9, "positionsKm": [(6790.0, 0.0, 0.0)] * 3,
              "earthRotationDeg": 264.7, "moonDirection": (1.0, 0.0, 0.0)},
}


class SatelliteLinkTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_app(serve_frontend=False))

    def test_lists_the_configured_satellites(self):
        listed = self.client.get("/api/satellites").json()
        self.assertEqual([(item["id"], item["name"]) for item in listed],
                         satellite_settings.AVAILABLE_SATELLITES)

    def test_passes_the_chosen_satellite_and_site_to_the_calculation(self):
        with patch.object(satellite_api, "_satellite_link", return_value=LINK) as link:
            response = self.client.post("/api/satellite-link", json=BODY)
        self.assertEqual(response.status_code, 200)
        latitude, longitude, start, satellite_id = link.call_args.args
        self.assertEqual((latitude, longitude, satellite_id), (-85.99, -0.125, 25544))
        self.assertEqual(start.isoformat(), "2026-11-15T14:00:00+00:00")
        self.assertEqual(response.json()["satellite"]["id"], 25544)

    def test_rejects_bad_input_before_any_calculation(self):
        with patch.object(satellite_api, "_satellite_link") as link:
            for change in ({"satelliteId": 1}, {"latitude": -90.0}, {"landingTimeUtc": "soon"}):
                self.assertEqual(self.client.post("/api/satellite-link", json=BODY | change).status_code, 422)
        link.assert_not_called()

    def test_reports_dates_too_far_from_the_orbit_epoch(self):
        with patch.object(satellite_api, "_satellite_link", side_effect=satellite_api.EpochTooFar("far")):
            response = self.client.post("/api/satellite-link", json=BODY)
        self.assertEqual(response.status_code, 409)
        self.assertIn("7 days", response.json()["detail"])

    def test_reports_orbit_download_failures(self):
        with patch.object(satellite_api, "_satellite_link", side_effect=RuntimeError("down")):
            response = self.client.post("/api/satellite-link", json=BODY)
        self.assertEqual(response.status_code, 502)


if __name__ == "__main__":
    unittest.main()
