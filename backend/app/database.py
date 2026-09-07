from supabase import create_client, Client
from functools import lru_cache
from .config import settings

@lru_cache()
def get_supabase_client() -> Client:
    """Get Supabase client instance"""
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key
    )

def get_db():
    """Dependency for database client"""
    return get_supabase_client()

# Service Role client for admin operations
def get_service_role_client() -> Client:
    return get_supabase_client()
