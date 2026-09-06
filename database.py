"""Database configuration and session management for AutoCFO.

Provides asynchronous PostgreSQL connection using SQLAlchemy 2.0+ and asyncpg,
with connection pooling, environment-based configuration, and session lifecycle management.
"""

import os
import sys
from typing import AsyncGenerator
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

load_dotenv()

# PostgreSQL async connection URL (default to local Docker/Postgres instance)
DEFAULT_DB_URL = "postgresql+asyncpg://postgres:postgres@localhost:5432/autocfo"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DB_URL)

# Normalization: ensure the URL uses the asyncpg driver for PostgreSQL
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://") and "+asyncpg" not in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

SQL_ECHO = os.getenv("SQL_ECHO", "false").lower() in ("true", "1", "yes")

# Configure engine arguments based on driver and environment
engine_kwargs = {
    "echo": SQL_ECHO,
    "future": True,
}

# If testing (e.g. pytest) or requested via env, use NullPool to prevent event-loop conflicts
is_testing = os.getenv("TESTING", "false").lower() in ("true", "1") or "pytest" in sys.modules

if "sqlite" in DATABASE_URL:
    engine_kwargs["connect_args"] = {"check_same_thread": False}
elif is_testing:
    engine_kwargs["poolclass"] = NullPool
else:
    # PostgreSQL connection pool settings for production stability
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_size"] = int(os.getenv("DB_POOL_SIZE", "10"))
    engine_kwargs["max_overflow"] = int(os.getenv("DB_MAX_OVERFLOW", "20"))

engine = create_async_engine(DATABASE_URL, **engine_kwargs)


# Async session factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    """Base declarative class for all SQLAlchemy ORM models."""
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding an async database session.

    Ensures rollback on exceptions and proper cleanup after request completion.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Initialize database schemas and create tables if they do not exist."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    """Dispose database engine connections gracefully."""
    await engine.dispose()
