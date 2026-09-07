from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from .database import get_supabase_client
from .core.security import decode_token
from .utils.logger import logger

security = HTTPBearer()

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Get current authenticated user"""
    try:
        token = credentials.credentials
        payload = decode_token(token)
        
        if not payload:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        # Get user from Supabase
        db = get_supabase_client()
        user = db.auth.get_user(token)
        
        if not user or not user.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        # Get member profile
        member = db.table("members").select("*").eq(
            "id", user.user.id
        ).execute()
        
        if member.data:
            user_data = user.user.dict()
            user_data["member_profile"] = member.data[0]
            user_data["membership_number"] = member.data[0].get("membership_number")
            return user_data
        
        return user.user.dict()
        
    except Exception as e:
        logger.error(f"Auth error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def get_current_member(current_user: dict = Depends(get_current_user)):
    """Get current member with validation"""
    if not current_user.get("member_profile"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Member profile not found"
        )
    return current_user

async def get_admin_user(current_user: dict = Depends(get_current_user)):
    """Get current admin user with validation"""
    if current_user.get("role") not in ["admin", "super_admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_user
