# ============================================================
# MAIN ENTRY POINT - backend/main.py
# Render runs: uvicorn main:app
# ============================================================

import sys
import os

# Add current directory to Python path
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

# Import the FastAPI app from app.main
try:
    from app.main import app
    print(f"✅ Successfully imported app")
except ImportError as e:
    print(f"❌ Failed to import app: {e}")
    print(f"PYTHONPATH: {sys.path}")
    raise

# This is what uvicorn will import as "main:app"
