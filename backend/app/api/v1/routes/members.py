from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import List, Optional
from ....database import get_supabase_client
from ....core.dependencies import get_current_user, get_current_member, get_admin_user
from ....services.member_service import member_service
from ....schemas.member import (
    MemberProfileResponse, MemberWithDetails, MemberUpdateRequest,
    MemberSearchRequest
)
from ....schemas.response import APIResponse, PaginatedResponse
from ....utils.logger import logger

router = APIRouter(prefix="/members", tags=["members"])

@router.get("/profile", response_model=MemberProfileResponse)
async def get_profile(current_user: dict = Depends(get_current_member)):
    """Get current member profile"""
    try:
        member = current_user.get("member_profile")
        if not member:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Member profile not found"
            )
        return member
        
    except Exception as e:
        logger.error(f"❌ Profile error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/profile", response_model=MemberProfileResponse)
async def update_profile(
    request: MemberUpdateRequest,
    current_user: dict = Depends(get_current_member)
):
    """Update member profile"""
    try:
        updated = await member_service.update_member(
            current_user["id"],
            request.dict(exclude_none=True)
        )
        return updated
        
    except Exception as e:
        logger.error(f"❌ Update profile error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{member_id}", response_model=MemberProfileResponse)
async def get_member(
    member_id: str,
    admin_user: dict = Depends(get_admin_user)
):
    """Get member by ID (Admin only)"""
    try:
        return await member_service.get_member_by_id(member_id)
        
    except Exception as e:
        logger.error(f"❌ Get member error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/", response_model=PaginatedResponse)
async def search_members(
    membership_number: Optional[str] = Query(None),
    phone: Optional[str] = Query(None),
    email: Optional[str] = Query(None),
    first_name: Optional[str] = Query(None),
    last_name: Optional[str] = Query(None),
    plan_type: Optional[str] = Query(None),
    branch: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    admin_user: dict = Depends(get_admin_user)
):
    """Search members (Admin only)"""
    try:
        search_params = {
            k: v for k, v in locals().items()
            if k in ["membership_number", "phone", "email", "first_name", 
                    "last_name", "plan_type", "branch", "is_active", "page", "limit"]
            and v is not None
        }
        
        results = await member_service.search_members(search_params)
        
        # Get total count
        db = get_supabase_client()
        count = db.table("members").select("*", count="exact").execute()
        
        return PaginatedResponse(
            items=results,
            total=count.count,
            page=page,
            limit=limit,
            pages=(count.count + limit - 1) // limit
        )
        
    except Exception as e:
        logger.error(f"❌ Search error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/{member_id}/status")
async def update_member_status(
    member_id: str,
    is_active: bool,
    admin_user: dict = Depends(get_admin_user)
):
    """Update member status (Admin only)"""
    try:
        updated = await member_service.update_member(
            member_id,
            {"is_active": is_active}
        )
        return {"message": f"Member {'activated' if is_active else 'deactivated'} successfully"}
        
    except Exception as e:
        logger.error(f"❌ Status update error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
