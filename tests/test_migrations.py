"""Migrations apply cleanly and match the SQLAlchemy models."""

from __future__ import annotations

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect

from app.db import make_engine, normalize_database_url
from app.migrate import upgrade
from app.models import Base

from .conftest import TEST_DATABASE_URL, reset_database


def test_migrations_match_models():
    reset_database(TEST_DATABASE_URL)
    engine = make_engine(TEST_DATABASE_URL)
    upgrade(engine)
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": True}), Base.metadata)
        tables = set(inspect(conn).get_table_names())
    engine.dispose()
    assert diff == []
    assert {
        "users",
        "sessions",
        "preferences",
        "saved_recipes",
        "pantry_items",
        "meal_plan_entries",
        "shopping_items",
        "generation_history",
    } <= tables


def test_normalize_database_url():
    assert normalize_database_url("postgres://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalize_database_url("postgresql://u@h/db") == "postgresql+psycopg://u@h/db"
    assert normalize_database_url("sqlite:///x.db") == "sqlite:///x.db"
