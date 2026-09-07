from pydantic_settings import BaseSettings
from typing import List, Optional
from functools import lru_cache

class Settings(BaseSettings):
    # Supabase
    supabase_url: str
    supabase_service_role_key: str
    
    # M-PESA
    mpesa_consumer_key: str
    mpesa_consumer_secret: str
    mpesa_passkey: str
    mpesa_shortcode: int
    mpesa_environment: str = "sandbox"
    mpesa_callback_url: str
    
    # App
    environment: str = "development"
    api_version: str = "2.0.0"
    debug: bool = False
    frontend_url: str
    allowed_origins: List[str]
    
    # Security
    secret_key: str
    access_token_expire_minutes: int = 60
    
    # Logging
    log_level: str = "INFO"
    log_format: str = "json"
    
    # Redis
    redis_url: Optional[str] = "redis://localhost:6379/0"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False

@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
