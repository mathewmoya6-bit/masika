"""
Custom Exception Handlers
"""

import logging
from typing import Union

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.models import APIResponse

logger = logging.getLogger(__name__)


# ============================================================
# CUSTOM EXCEPTIONS
# ============================================================

class BusinessError(Exception):
    """Business logic error."""
    def __init__(self, message: str, code: str = "BUSINESS_ERROR", status_code: int = 400):
        self.message = message
        self.code = code
        self.status_code = status_code
        super().__init__(message)

class NotFoundError(BusinessError):
    """Resource not found."""
    def __init__(self, resource: str, identifier: str = ""):
        super().__init__(
            message=f"{resource} not found{': ' + identifier if identifier else ''}",
            code="NOT_FOUND",
            status_code=404
        )

class DuplicateError(BusinessError):
    """Duplicate resource."""
    def __init__(self, resource: str, field: str, value: str):
        super().__init__(
            message=f"{resource} with {field} '{value}' already exists",
            code="DUPLICATE",
            status_code=409
        )

class ValidationError(BusinessError):
    """Validation error."""
    def __init__(self, message: str):
        super().__init__(message, code="VALIDATION_ERROR", status_code=400)

class PermissionError(BusinessError):
    """Permission error."""
    def __init__(self, message: str = "Permission denied"):
        super().__init__(message, code="PERMISSION_DENIED", status_code=403)


# ============================================================
# EXCEPTION HANDLERS
# ============================================================

async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Handle HTTP exceptions."""
    logger.warning(f"HTTP exception: {exc.detail}")
    return JSONResponse(
        status_code=exc.status_code,
        content=APIResponse(
            success=False,
            message=str(exc.detail),
            error=exc.detail if isinstance(exc.detail, str) else None,
        ).model_dump()
    )

async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle validation errors."""
    errors = []
    for error in exc.errors():
        field = ".".join(str(loc) for loc in error["loc"])
        errors.append(f"{field}: {error['msg']}")
    
    message = "Validation error: " + "; ".join(errors)
    logger.warning(f"Validation error: {message}")
    
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=APIResponse(
            success=False,
            message="Validation error",
            error=message,
        ).model_dump()
    )

async def business_error_handler(request: Request, exc: BusinessError):
    """Handle business errors."""
    logger.warning(f"Business error: {exc.code} - {exc.message}")
    return JSONResponse(
        status_code=exc.status_code,
        content=APIResponse(
            success=False,
            message=exc.message,
            error=exc.code,
        ).model_dump()
    )

async def generic_exception_handler(request: Request, exc: Exception):
    """Handle unhandled exceptions."""
    logger.exception(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=APIResponse(
            success=False,
            message="Internal server error",
            error="An unexpected error occurred",
        ).model_dump()
    )


# ============================================================
# REGISTER HANDLERS
# ============================================================

def register_exception_handlers(app: FastAPI):
    """Register all exception handlers."""
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(BusinessError, business_error_handler)
    app.add_exception_handler(Exception, generic_exception_handler)
    
    logger.info("Exception handlers registered")


# ============================================================
# EXPORTS
# ============================================================

__all__ = [
    "BusinessError",
    "NotFoundError",
    "DuplicateError",
    "ValidationError",
    "PermissionError",
    "register_exception_handlers",
]
