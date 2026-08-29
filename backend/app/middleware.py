"""
Custom Middleware
"""

import time
import uuid
import logging
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


# ============================================================
# REQUEST LOGGING MIDDLEWARE
# ============================================================

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log all requests with timing."""
    
    async def dispatch(self, request: Request, call_next: Callable):
        # Generate request ID
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id
        
        # Start timer
        start_time = time.time()
        
        # Log request
        logger.info(
            f"Request: {request.method} {request.url.path}",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "client": request.client.host if request.client else None,
            }
        )
        
        # Process request
        response = await call_next(request)
        
        # Calculate duration
        duration = (time.time() - start_time) * 1000
        
        # Add request ID to response headers
        response.headers["X-Request-ID"] = request_id
        
        # Log response
        logger.info(
            f"Response: {request.method} {request.url.path} - {response.status_code} ({duration:.2f}ms)",
            extra={
                "request_id": request_id,
                "status_code": response.status_code,
                "duration_ms": round(duration, 2),
            }
        )
        
        return response


# ============================================================
# SECURITY HEADERS MIDDLEWARE
# ============================================================

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""
    
    async def dispatch(self, request: Request, call_next: Callable):
        response = await call_next(request)
        
        # Security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        
        # HSTS (only in production)
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        
        # CORS headers are handled by CORSMiddleware
        
        return response


# ============================================================
# RATE LIMITING MIDDLEWARE (Optional)
# ============================================================

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple rate limiting (alternative to slowapi)."""
    
    def __init__(self, app, calls_per_minute: int = 60):
        super().__init__(app)
        self.calls_per_minute = calls_per_minute
        self.requests = {}
    
    async def dispatch(self, request: Request, call_next: Callable):
        # Get client IP
        client_ip = request.client.host if request.client else "unknown"
        
        # Check rate limit
        from datetime import datetime, timedelta
        
        now = datetime.now()
        if client_ip not in self.requests:
            self.requests[client_ip] = []
        
        # Clean old requests
        self.requests[client_ip] = [
            t for t in self.requests[client_ip]
            if t > now - timedelta(minutes=1)
        ]
        
        # Check if limit exceeded
        if len(self.requests[client_ip]) >= self.calls_per_minute:
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=429,
                content={
                    "success": False,
                    "message": "Rate limit exceeded. Please try again later.",
                    "error": "RATE_LIMIT_EXCEEDED",
                }
            )
        
        # Add request timestamp
        self.requests[client_ip].append(now)
        
        return await call_next(request)


# ============================================================
# EXPORTS
# ============================================================

__all__ = [
    "RequestLoggingMiddleware",
    "SecurityHeadersMiddleware",
    "RateLimitMiddleware",
]
