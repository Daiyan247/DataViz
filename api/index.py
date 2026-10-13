"""Vercel entry point: serves the FastAPI app in server/main.py as a serverless function.

vercel.json rewrites every /api/* request here, and FastAPI's own routes
(/api/chart-spec, /api/analyse, ...) take it from there.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server.main import app  # noqa: E402,F401
