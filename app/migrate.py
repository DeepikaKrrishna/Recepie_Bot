"""Run Alembic migrations programmatically (used at dev startup and in tests).

Production runs `alembic upgrade head` as part of the deploy start command.
"""

from __future__ import annotations

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import Engine

from .config import BASE_DIR


def alembic_config() -> Config:
    cfg = Config(str(BASE_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BASE_DIR / "migrations"))
    cfg.attributes["configure_logger"] = False
    return cfg


def upgrade(engine: Engine, revision: str = "head") -> None:
    cfg = alembic_config()
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, revision)
