# ============================================================
# MASIKA BENEVOLENT - GUNICORN CONFIGURATION
# ============================================================

import os
import multiprocessing

# ============================================================
# SERVER
# ============================================================

bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
backlog = 2048

# ============================================================
# WORKERS
# ============================================================

# Number of worker processes
workers = multiprocessing.cpu_count() * 2 + 1

# Worker class (use Uvicorn worker for ASGI)
worker_class = "uvicorn.workers.UvicornWorker"

# Worker connections
worker_connections = 1000

# Timeouts
timeout = 120
keepalive = 5
graceful_timeout = 30

# ============================================================
# LOGGING
# ============================================================

accesslog = "-"
errorlog = "-"
loglevel = "info"

# Access log format
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# ============================================================
# PROCESS
# ============================================================

proc_name = "masika-api"
daemon = False
umask = 0
user = None
group = None

# ============================================================
# PRELOAD
# ============================================================

preload_app = True

# ============================================================
# ENVIRONMENT
# ============================================================

raw_env = [
    f"ENVIRONMENT={os.getenv('ENVIRONMENT', 'production')}",
    f"SUPABASE_URL={os.getenv('SUPABASE_URL', '')}",
    f"SUPABASE_SERVICE_ROLE_KEY={os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')}",
    f"MPESA_CONSUMER_KEY={os.getenv('MPESA_CONSUMER_KEY', '')}",
    f"MPESA_CONSUMER_SECRET={os.getenv('MPESA_CONSUMER_SECRET', '')}",
    f"MPESA_PASSKEY={os.getenv('MPESA_PASSKEY', '')}",
    f"MPESA_SHORTCODE={os.getenv('MPESA_SHORTCODE', '348127')}",
    f"MPESA_ENVIRONMENT={os.getenv('MPESA_ENVIRONMENT', 'production')}",
    f"MPESA_CALLBACK_URL={os.getenv('MPESA_CALLBACK_URL', '')}",
    f"FRONTEND_URL={os.getenv('FRONTEND_URL', 'https://www.masikabbs.com')}",
    f"LOG_LEVEL={os.getenv('LOG_LEVEL', 'INFO')}",
]
