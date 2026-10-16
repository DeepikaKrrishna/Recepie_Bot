"""Database models. Every user-owned row carries `user_id` with ON DELETE CASCADE,
and every query in the routers filters by the authenticated user's id."""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def as_utc(value: dt.datetime) -> dt.datetime:
    """SQLite drops tzinfo; treat naive values from the DB as UTC."""
    return value if value.tzinfo else value.replace(tzinfo=dt.UTC)


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[Any]: JSON}


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(60), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())
    rescued_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    cooked_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    preferences: Mapped[Preferences | None] = relationship(back_populates="user", cascade="all, delete-orphan", uselist=False)


class UserSession(Base):
    __tablename__ = "sessions"

    # SHA-256 of the session token; the raw token only ever lives in the user's cookie.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)


class Preferences(Base):
    __tablename__ = "preferences"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    diets: Mapped[list[Any]] = mapped_column(JSON, default=list)
    cuisine: Mapped[str] = mapped_column(String(40), default="Any")
    servings: Mapped[int] = mapped_column(Integer, default=2)
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    exclude: Mapped[list[Any]] = mapped_column(JSON, default=list)
    history_retention_days: Mapped[int] = mapped_column(Integer, default=30)

    user: Mapped[User] = relationship(back_populates="preferences")


class SavedRecipe(Base):
    __tablename__ = "saved_recipes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    notes: Mapped[str] = mapped_column(Text, default="")
    cooked_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_cooked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Random token; set only when the owner explicitly shares the recipe.
    share_id: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PantryItem(Base):
    __tablename__ = "pantry_items"
    __table_args__ = (Index("ix_pantry_user_expiry", "user_id", "expires_on"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(60))
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(24), default="")
    category: Mapped[str] = mapped_column(String(30), default="Other")
    expires_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class MealPlanEntry(Base):
    __tablename__ = "meal_plan_entries"
    __table_args__ = (
        Index("ix_plan_user_day", "user_id", "day"),
        UniqueConstraint("user_id", "day", "slot", name="uq_plan_slot"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    day: Mapped[dt.date] = mapped_column(Date)
    slot: Mapped[str] = mapped_column(String(12))  # breakfast | lunch | dinner | snack
    recipe_id: Mapped[int] = mapped_column(ForeignKey("saved_recipes.id", ondelete="CASCADE"))
    servings: Mapped[int] = mapped_column(Integer, default=2)

    recipe: Mapped[SavedRecipe] = relationship()


class ShoppingItem(Base):
    __tablename__ = "shopping_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(24), default="")
    category: Mapped[str] = mapped_column(String(30), default="Other")
    checked: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    source: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GenerationHistory(Base):
    __tablename__ = "generation_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    request: Mapped[dict[str, Any]] = mapped_column(JSON)
    titles: Mapped[list[Any]] = mapped_column(JSON)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)
