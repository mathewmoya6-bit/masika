from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from datetime import timedelta
from ....database import get_supabase_client
from ....core.security import create_access_token, create_refresh_token, decode_token
from ....core.exceptions import AuthException, ValidationException
from ....services.member_service import member_service
from ....services.notification_service import notification_service
from ....schemas.auth import (
    LoginRequest, LoginResponse, RegisterRequest, RegisterResponse,
    RefreshTokenRequest, ChangePasswordRequest
)
from ....utils.logger import logger

router = APIRouter(prefix="/auth", tags=["authentication"])
security = HTTPBearer()

@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Authenticate user and return JWT token"""
    try:
        db = get_supabase_client()
        
        # Sign in with Supabase
        user = db.auth.sign_in_with_password({
            "email": request.email,
            "password": request.password
        })
        
        if not user or not user.user:
            raise AuthException("Invalid credentials")
        
        # Get member profile
        member = db.table("members").select("*").eq(
            "id", user.user.id
        ).execute()
        
        # Create access token
        token_data = {
            "sub": user.user.email,
            "user_id": user.user.id,
            "email": user.user.email,
            "role": user.user.user_metadata.get("role", "member")
        }
        
        access_token = create_access_token(token_data)
        refresh_token = create_refresh_token(token_data)
        
        # Prepare user data
        user_data = user.user.dict()
        if member.data:
            user_data["member_profile"] = member.data[0]
            user_data["membership_number"] = member.data[0].get("membership_number")
        
        logger.info(f"✅ User logged in: {request.email}")
        
        return LoginResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            user=user_data
        )
        
    except Exception as e:
        logger.error(f"❌ Login error: {str(e)}")
        raise AuthException("Invalid credentials")

@router.post("/register", response_model=RegisterResponse)
async def register(request: RegisterRequest):
    """Register a new member"""
    try:
        db = get_supabase_client()
        
        # Check if user exists
        existing = db.auth.sign_in_with_password({
            "email": request.email,
            "password": request.password
        })
        
        if existing and existing.user:
            raise ValidationException("Email already registered")
        
        # Create Supabase Auth user
        auth_response = db.auth.sign_up({
            "email": request.email,
            "password": request.password,
            "options": {
                "data": {
                    "first_name": request.first_name,
                    "last_name": request.last_name,
                    "role": "member"
                }
            }
        })
        
        if not auth_response.user:
            raise ValidationException("Failed to create user")
        
        # Create member record
        member_data = {
            "id": auth_response.user.id,
            "first_name": request.first_name,
            "last_name": request.last_name,
            "email": request.email,
            "phone": request.phone,
            "id_number": request.id_number,
            "date_of_birth": request.date_of_birth,
            "gender": request.gender,
            "plan_type": request.plan_type,
            "branch": request.branch,
            "agent_id": request.agent_id
        }
        
        member = await member_service.create_member(member_data)
        
        # Send welcome notification
        await notification_service.send_welcome_message(member)
        
        logger.info(f"✅ New member registered: {member['membership_number']}")
        
        return RegisterResponse(
            message="Registration successful",
            membership_number=member["membership_number"],
            user=auth_response.user
        )
        
    except Exception as e:
        logger.error(f"❌ Registration error: {str(e)}")
        raise ValidationException(str(e))

@router.post("/refresh")
async def refresh_token(request: RefreshTokenRequest):
    """Refresh access token"""
    try:
        payload = decode_token(request.refresh_token)
        
        if not payload:
            raise AuthException("Invalid refresh token")
        
        # Create new access token
        token_data = {
            "sub": payload.get("sub"),
            "user_id": payload.get("user_id"),
            "email": payload.get("email"),
            "role": payload.get("role")
        }
        
        access_token = create_access_token(token_data)
        
        return {"access_token": access_token, "token_type": "bearer"}
        
    except Exception as e:
        logger.error(f"❌ Refresh error: {str(e)}")
        raise AuthException("Invalid refresh token")

@router.post("/logout")
async def logout(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Logout user"""
    try:
        # Invalidate token (implementation depends on your token strategy)
        # For JWT, we don't need to do anything server-side
        return {"message": "Logged out successfully"}
        
    except Exception as e:
        logger.error(f"❌ Logout error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/change-password")
async def change_password(
    request: ChangePasswordRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """Change user password"""
    try:
        db = get_supabase_client()
        
        # Decode token
        payload = decode_token(credentials.credentials)
        
        if not payload:
            raise AuthException("Invalid token")
        
        # Update password
        db.auth.update_user({
            "password": request.new_password
        })
        
        logger.info(f"✅ Password changed for: {payload.get('email')}")
        return {"message": "Password changed successfully"}
        
    except Exception as e:
        logger.error(f"❌ Password change error: {str(e)}")
        raise AuthException("Failed to change password")

@router.get("/verify")
async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verify JWT token"""
    try:
        payload = decode_token(credentials.credentials)
        
        if not payload:
            raise AuthException("Invalid token")
        
        return {"valid": True, "user": payload}
        
    except Exception as e:
        logger.error(f"❌ Token verification error: {str(e)}")
        raise AuthException("Invalid token")
