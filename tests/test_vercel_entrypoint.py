"""Check the deployment entrypoint independently of any local frontend build."""

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.routing import Mount

from src.Ephemeris.Earth_sun_Position.api import create_app


class VercelEntrypointTest(unittest.TestCase):
    def test_api_service_does_not_mount_frontend_even_when_dist_exists(self):
        with patch('src.Ephemeris.Earth_sun_Position.api.FRONTEND_DIST') as dist:
            dist.__truediv__.return_value.is_file.return_value = True
            app = create_app(serve_frontend=False)
        self.assertFalse(any(isinstance(route, Mount) for route in app.routes))
        with TestClient(app) as client:
            self.assertEqual(client.get('/api/sites').status_code, 200)
            self.assertEqual(client.get('/').status_code, 404)
            self.assertEqual(client.get('/sites').status_code, 404)

    def test_vercel_exports_api_app(self):
        from app import app
        with TestClient(app) as client:
            self.assertEqual(client.get('/api/sites').status_code, 200)
            self.assertEqual(client.get('/assets/moon.jpg').status_code, 404)


if __name__ == '__main__':
    unittest.main()
