from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from .config import settings
from .core.middleware import LoggingMiddleware, RateLimitMiddleware
from .api.v1.routes import (
    auth_router, members_router, payments_router, 
    plans_router, dashboard_router, webhooks_router,
    mpesa_router  # ← NEW
)
from .utils.logger import logger

# Create FastAPI app
app = FastAPI(
    title="Masika Benevolent API",
    description="Last-expense coverage API for Masika Benevolent",
    version=settings.api_version,
    docs_url="/api/docs" if settings.debug else None,
    redoc_url="/api/redoc" if settings.debug else None,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Trusted host middleware
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"] if settings.debug else [".onrender.com", "masikabbs.com"]
)

# Custom middleware
app.add_middleware(LoggingMiddleware)
app.add_middleware(RateLimitMiddleware)

# Health check
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "version": settings.api_version,
        "environment": settings.environment
    }

# Root endpoint
@app.get("/")
async def root():
    return {
        "message": "Welcome to Masika Benevolent API",
        "version": settings.api_version,
        "docs": "/api/docs" if settings.debug else None
    }

# Register routes
app.include_router(auth_router, prefix="/api/v1")
app.include_router(members_router, prefix="/api/v1")
app.include_router(payments_router, prefix="/api/v1")
app.include_router(plans_router, prefix="/api/v1")
app.include_router(dashboard_router, prefix="/api/v1")
app.include_router(webhooks_router, prefix="/api/v1")
app.include_router(mpesa_router, prefix="/api/v1")  # ← NEW

# Exception handlers
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"}
    )

# Startup event
@app.on_event("startup")
async def startup():
    logger.info(f"🚀 Starting Masika Benevolent API v{settings.api_version}")
    logger.info(f"📍 Environment: {settings.environment}")
    logger.info(f"🔗 Frontend URL: {settings.frontend_url}")
    logger.info(f"📡 M-PESA Callback: {settings.mpesa_callback_url}")

# Shutdown event
@app.on_event("shutdown")
async def shutdown():
    logger.info("🛑 Shutting down Masika Benevolent API")
