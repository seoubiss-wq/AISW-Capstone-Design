from __future__ import annotations

import os


def read_int(name: str, default: int, minimum: int = 1, maximum: int = 10_000) -> int:
    raw = str(os.getenv(name, "")).strip()
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


bind = f"0.0.0.0:{read_int('PORT', read_int('AI_PORT', 8001, 1, 65535), 1, 65535)}"
workers = read_int("GUNICORN_WORKERS", 1, 1, 8)
threads = read_int("GUNICORN_THREADS", 2, 1, 32)
timeout = read_int("GUNICORN_TIMEOUT", 300, 30, 3600)
graceful_timeout = read_int("GUNICORN_GRACEFUL_TIMEOUT", 60, 10, 600)
keepalive = read_int("GUNICORN_KEEPALIVE", 5, 1, 120)
max_requests = read_int("GUNICORN_MAX_REQUESTS", 200, 0, 100000)
max_requests_jitter = read_int("GUNICORN_MAX_REQUESTS_JITTER", 20, 0, 10000)
worker_class = "gthread" if threads > 1 else "sync"
accesslog = "-"
errorlog = "-"
loglevel = str(os.getenv("GUNICORN_LOG_LEVEL", os.getenv("AI_LOG_LEVEL", "info"))).strip().lower() or "info"
preload_app = False

