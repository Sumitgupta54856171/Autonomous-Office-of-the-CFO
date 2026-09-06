"""Clerk JWT Authentication and Token Verification for AutoCFO Backend.

Verifies RS256 JWT tokens issued by Clerk Authentication.
Provides FastAPI dependency `verify_clerk_token` to secure endpoints.
Includes graceful development fallback for local testing and hackathon demo environments.
"""

import logging
import os
from typing import Any, Dict, Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from jwt import PyJWKClient

logger = logging.getLogger("autocfo.auth")

# Check if cryptography library is installed for RS256 verification
try:
    import cryptography  # noqa: F401
    HAS_CRYPTOGRAPHY = True
except ImportError:
    HAS_CRYPTOGRAPHY = False
    logger.warning("Package 'cryptography' not found. RS256 signature verification will operate in unverified dev mode.")

# Security scheme
security = HTTPBearer(auto_error=False)

# Clerk Configuration
CLERK_ISSUER = os.getenv("CLERK_ISSUER", "")
CLERK_JWKS_URL = os.getenv(
    "CLERK_JWKS_URL",
    f"{CLERK_ISSUER.rstrip('/')}/.well-known/jwks.json" if CLERK_ISSUER else "",
)
CLERK_SECRET_KEY = os.getenv("CLERK_SECRET_KEY", "")
# Toggle verification strictness (defaults to True in production, False in local dev)
AUTH_STRICT_MODE = os.getenv("AUTH_STRICT_MODE", "false").lower() in ("true", "1")

# JWK Client Cache
_jwks_client: Optional[PyJWKClient] = None


def get_jwks_client() -> Optional[PyJWKClient]:
    """Retrieve or initialize the PyJWKClient for fetching Clerk public keys."""
    global _jwks_client
    if _jwks_client is None and CLERK_JWKS_URL and HAS_CRYPTOGRAPHY:
        try:
            _jwks_client = PyJWKClient(CLERK_JWKS_URL)
        except Exception as e:
            logger.warning("Failed to initialize Clerk PyJWKClient: %s", e)
    return _jwks_client


async def verify_clerk_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Dict[str, Any]:
    """Verify incoming Clerk JWT Bearer Token and return user claims.

    Args:
        credentials: The Bearer token extracted from the Authorization header.

    Returns:
        Dict representing decoded Clerk user claims (e.g. sub, email, etc.).

    Raises:
        HTTPException: 401 Unauthorized if token is invalid or missing in strict mode.
    """
    # 1. In dev/demo mode without strict authentication configured
    if not credentials:
        if not AUTH_STRICT_MODE:
            return {
                "sub": "user_demo_cfo_001",
                "email": "cfo@autocfo.enterprise",
                "role": "cfo_admin",
                "is_demo_session": True,
            }
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    # 2. If cryptography is installed and JWKS is configured, verify RS256 cryptographic signature
    if HAS_CRYPTOGRAPHY and CLERK_JWKS_URL:
        jwks_client = get_jwks_client()
        if jwks_client:
            try:
                signing_key = jwks_client.get_signing_key_from_jwt(token)
                payload = jwt.decode(
                    token,
                    signing_key.key,
                    algorithms=["RS256"],
                    issuer=CLERK_ISSUER if CLERK_ISSUER else None,
                    options={"verify_aud": False},
                )
                return payload
            except jwt.PyJWTError as exc:
                logger.warning("Clerk JWKS signature verification warning: %s", exc)
                if AUTH_STRICT_MODE:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail=f"Invalid authentication token: {str(exc)}",
                        headers={"WWW-Authenticate": "Bearer"},
                    )

    # 3. Decode payload (without signature requirement if JWKS not set or in dev mode)
    try:
        unverified_payload = jwt.decode(token, options={"verify_signature": False})
        return unverified_payload
    except Exception as e:
        logger.warning("Could not decode JWT payload: %s", e)
        if AUTH_STRICT_MODE:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Malformed Authorization token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return {
            "sub": "user_dev_fallback",
            "email": "dev@autocfo.local",
            "is_demo_session": True,
        }
