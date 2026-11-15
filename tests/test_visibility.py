import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

from src.Ephemeris.Earth_sun_Position.api import create_app
from src.Ephemeris.Earth_sun_Position.Position_and_zenith_compilation import HorizonsTimeout


LANDING = '2026-11-14T12:00:00.000Z'
REQUEST = {'latitude': -85.99, 'longitude': -0.125, 'landingTimeUtc': LANDING}
EPHEMERIS = 'src.Ephemeris.Earth_sun_Position.Position_and_zenith_compilation.get_table'
TERRAIN = 'src.terrain.visibility'


def observer_table(settings, **_kwargs):
    start = datetime.fromisoformat(settings['START_TIME']).replace(tzinfo=timezone.utc)
    sun = settings['COMMAND'] == '10'
    header = ['Date__(UT)__HR:MN', 'Azi_(a-app)', 'Elev_(a-app)']
    rows = [
        [(start + timedelta(minutes=15 * index)).strftime('%Y-%b-%d %H:%M'),
         '359.75' if sun else '180', '1.9' if sun else '3.0']
        for index in range(289)
    ]
    return header, rows


class VisibilityTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_app())
        self.addCleanup(self.client.close)

    def test_presets_and_geometric_fallback(self):
        sites = self.client.get('/api/sites').json()
        self.assertEqual(len(sites), 9)
        self.assertIn({'name': 'Malapert Massif', 'latitude': -85.99, 'longitude': -0.125}, sites)

        with patch(EPHEMERIS, side_effect=observer_table) as upstream, \
             patch(f'{TERRAIN}.DEM_PATH') as dem:
            dem.is_file.return_value = False
            result = self.client.post('/api/visibility', json=REQUEST)

        self.assertEqual(result.status_code, 200, result.text[:300])
        calls = [call.args[0] for call in upstream.call_args_list]
        self.assertEqual([call['COMMAND'] for call in calls], ['10', '399'])
        for call in calls:
            self.assertEqual(call['SITE_COORD'], '-0.125,-85.99,0.0')
            self.assertEqual(call['STOP_TIME'], '2026-11-17 12:00')
        data = result.json()
        self.assertEqual(data['horizon']['reason'], 'dem-missing')
        self.assertEqual(len(data['samples']), 289)
        self.assertEqual(data['samples'][0]['utc'], '2026-11-14T12:00:00Z')
        self.assertEqual(data['samples'][-1]['utc'], '2026-11-17T12:00:00Z')
        self.assertEqual(data['samples'][0]['earth']['visibilityClearanceDeg'], 3)

    def test_lola_profile_wraps_and_changes_visibility(self):
        with patch(EPHEMERIS, side_effect=observer_table), \
             patch(f'{TERRAIN}.DEM_PATH') as dem, patch(f'{TERRAIN}._profile') as profile:
            dem.is_file.return_value = True
            profile.return_value = np.arange(0, 360, 0.5), np.full(720, 2.0), -1250.0
            result = self.client.post('/api/visibility', json=REQUEST)

        self.assertEqual(result.status_code, 200, result.text[:300])
        profile.assert_called_once_with(-85.99, -0.125)
        data = result.json()
        self.assertEqual(data['horizon'], {'source': 'lola', 'reason': None, 'groundElevationM': -1250.0})
        sun, earth = (data['samples'][0][body] for body in ('sun', 'earth'))
        self.assertEqual(sun['horizonElevationDeg'], 2.0)
        self.assertTrue(0 < sun['visibleFraction'] < 0.5)
        self.assertGreater(sun['visibilityClearanceDeg'], 0)
        self.assertEqual(earth['visibilityClearanceDeg'], 1.0)

    def test_missing_ray_uses_one_consistent_horizon(self):
        mask = np.full(720, 2.0)
        mask[0] = np.nan
        with patch(EPHEMERIS, side_effect=observer_table), \
             patch(f'{TERRAIN}.DEM_PATH') as dem, patch(f'{TERRAIN}._profile') as profile:
            dem.is_file.return_value = True
            profile.return_value = np.arange(0, 360, 0.5), mask, -1250.0
            data = self.client.post('/api/visibility', json=REQUEST).json()

        self.assertEqual(data['horizon']['reason'], 'incomplete-coverage')
        self.assertEqual(data['samples'][0]['earth']['horizonElevationDeg'], 0.0)

    def test_invalid_input_and_upstream_failures(self):
        with patch(EPHEMERIS) as upstream:
            for invalid in ({'longitude': -181}, {'landingTimeUtc': '2026-11-14T12:00:01Z'}):
                self.assertEqual(self.client.post('/api/visibility', json=REQUEST | invalid).status_code, 422)
            upstream.assert_not_called()
            upstream.side_effect = HorizonsTimeout('test timeout')
            self.assertEqual(self.client.post('/api/visibility', json=REQUEST).status_code, 504)
            upstream.side_effect = None
            upstream.return_value = [], []
            self.assertEqual(self.client.post('/api/visibility', json=REQUEST).status_code, 502)

    def test_terrain_passes_coordinates_and_reports_coverage(self):
        with patch('src.Ephemeris.Earth_sun_Position.api.surface_mesh', return_value=b'terrain') as build:
            response = self.client.get('/api/terrain', params={'latitude': -181, 'longitude': 0})
            self.assertEqual(response.status_code, 422)
            response = self.client.get('/api/terrain', params={'latitude': 0, 'longitude': 0})
            self.assertEqual(response.status_code, 404)
            build.assert_not_called()

            params = {'latitude': -85.99, 'longitude': -0.125}
            response = self.client.get('/api/terrain', params=params)
            build.assert_called_once_with(-85.99, -0.125)
            self.assertEqual(response.headers['content-type'], 'application/octet-stream')
            self.assertEqual(response.content, b'terrain')

            build.return_value = None
            self.assertEqual(self.client.get('/api/terrain', params=params).status_code, 404)
            build.side_effect = FileNotFoundError()
            self.assertEqual(self.client.get('/api/terrain', params=params).status_code, 503)
