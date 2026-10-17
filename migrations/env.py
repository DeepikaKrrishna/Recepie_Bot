"""Alembic environment. The database URL comes from DATABASE_URL (or .env),
never from alembic.ini, so no credentials are committed."""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import Connection

from app.config import load_settings
from app.db import make_engine, normalize_database_url
from app.models import Base

config = context.config
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _url() -> str:
    return normalize_database_url(config.attributes.get("database_url") or load_settings().database_url)


def _configure(connection: Connection | None = None, url: str | None = None) -> None:
    is_sqlite = (url or str(connection.engine.url)).startswith("sqlite")
    context.configure(
        connection=connection,
        url=url,
        target_metadata=target_metadata,
        render_as_batch=is_sqlite,  # SQLite needs batch mode for ALTER TABLE
        compare_type=True,
        literal_binds=connection is None,
    )


def run_migrations_offline() -> None:
    _configure(url=_url())
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        _configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()
        return
    engine = make_engine(_url())
    with engine.connect() as conn:
        _configure(connection=conn)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
