"""
Platform-wide constants for NexAU and Mash.
"""

from __future__ import annotations

# Universal filesystem exclusions for file searching, globbing, and bulk inspection.
# Contains ONLY universal machine-generated runtime and VCS noise.
# NEVER exclude user or business domain folders (e.g. reports, build, dist, data).
DEFAULT_SEARCH_EXCLUDES: list[str] = [
    ".git",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
]

DEFAULT_FILE_EXCLUDE_PATTERNS: list[str] = [
    "*.pyc",
    "*.pyo",
    "*.so",
    "*.o",
    "*.a",
    "*.lib",
    "*.dll",
    "*.exe",
    "*.dylib",
]
