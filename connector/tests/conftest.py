import os
import sys
from pathlib import Path
import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Tests now use httpx.ASGITransport(app=app) instead of spinning up a live background server.
# This prevents port deadlocks, zombie processes, and allows concurrent test execution via xdist.

