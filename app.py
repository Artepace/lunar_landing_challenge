"""Vercel's API-only entrypoint; Vite owns the public frontend service."""

from src.Ephemeris.api import create_app

app = create_app(serve_frontend=False)
