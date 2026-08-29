"""
Authentication & Authorization
"""

import logging
from typing import Optional, Dict, Any

from fastapi import HTTPException, status, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import Client

from app.config import settings
from app.database import get_supabase

logger = logging.getLogger(__name__)

# Security scheme
security = HTTPBearer(auto_error=False)


# ============================================================
# TOKEN VERIFICATION
# ============================================================

async def verify_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Verify JWT token with Supabase.
    Returns user data if valid, None otherwise.
    """
    try:
        supabase = get_supabase()
        response = supabase.auth.get_user(token)
        
        if not response.user:
            return None
        
        return {
            "user": response.user,
            "user_id": response.user.id,
            "email": response.user.email,
            "metadata": response.user.user_metadata,
        }
    except Exception as e:
        logger.warning(f"Token verification failed: {e}")
        return None


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Dict[str, Any]:
    """
    Get current authenticated user.
    Raises 401 if not authenticated.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_data = await verify_token(credentials.credentials)
    
    if not user_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return user_data


# ============================================================
# STAFF VERIFICATION
# ============================================================

async def verify_staff(user_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Verify that user is a staff member.
    Raises 403 if not authorized.
    """
    supabase = get_supabase()
    user_id = user_data["user_id"]
    
    try:
        # Check admin_profiles table
        result = supabase.table("admin_profiles").select(
            "id, role, is_active, full_name"
        ).eq("user_id", user_id).eq("is_active", True).execute()
        
        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized as staff"
            )
        
        staff_data = result.data[0]
        
        # Check role
        allowed_roles = ["super_admin", "admin", "manager"]
        if staff_data.get("role", "").lower() not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )
        
        return {
            **user_data,
            "staff": staff_data,
            "staff_id": staff_data["id"],
            "staff_role": staff_data["role"],
            "staff_name": staff_data.get("full_name", "Staff"),
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Staff verification error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Staff verification failed"
        )


async def get_current_staff(
    user_data: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Get current staff user with verification.
    """
    return await verify_staff(user_data)


async def get_admin_user(
    user_data: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Get current admin user (super_admin only).
    """
    staff_data = await verify_staff(user_data)
    
    if staff_data["staff_role"].lower() != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin privileges required"
        )
    
    return staff_data


# ============================================================
# STAFF LOGIN
# ============================================================

async def staff_login(email: str, password: str) -> Dict[str, Any]:
    """
    Staff login - returns session data.
    """
    supabase = get_supabase()
    
    try:
        # Authenticate with Supabase
        response = supabase.auth.sign_in_with_password({
            "email": email,
            "password": password
        })
        
        if not response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials"
            )
        
        # Verify staff status
        user_data = {"user": response.user, "user_id": response.user.id}
        staff_data = await verify_staff(user_data)
        
        return {
            "success": True,
            "session": response.session,
            "user": response.user,
            "staff": staff_data["staff"],
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Staff login error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Login failed"
        )


# ============================================================
# EXPORTS
# ============================================================

__all__ = [
    "security",
    "verify_token",
    "get_current_user",
    "get_current_staff",
    "get_admin_user",
    "staff_login",
]
