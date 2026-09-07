# ============================================================
# BACKEND ENTRY POINT - main.py
# This is the root file that uvicorn/gunicorn runs
# ============================================================

import sys
import os
from pathlib import Path

# Add the parent directory to path so we can import app
sys.path.insert(0, str(Path(__file__).parent))

from app.main import app  # Absolute import
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False
    )
