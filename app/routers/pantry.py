"""Smart Pantry: ingredients with quantities and expiry dates, plus the
"use it up" loop that counts food rescued from waste."""

from __future__ import annotations

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import AuthContext, require_auth, require_csrf
from ..db import get_db
from ..kitchen import CATEGORY_NAMES, categorize
from ..models import PantryItem, User, utcnow
from ..schemas import clean_text

router = APIRouter(prefix="/api/pantry", tags=["pantry"])

MAX_ITEMS = 300
EXPIRING_DAYS = 3


def _valid_category(v: str | None) -> str | None:
    if v is not None and v not in CATEGORY_NAMES:
        raise ValueError("Unknown category")
    return v


class ItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: Annotated[str, StringConstraints(min_length=1, max_length=60)]
    quantity: float | None = Field(default=None, ge=0, le=100_000)
    unit: Annotated[str, StringConstraints(max_length=24)] = ""
    category: str | None = None
    expires_on: dt.date | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = clean_text(v)
        if not v:
            raise ValueError("Name is required")
        return v

    @field_validator("category")
    @classmethod
    def _cat(cls, v: str | None) -> str | None:
        return _valid_category(v)

    @field_validator("expires_on")
    @classmethod
    def _date(cls, v: dt.date | None) -> dt.date | None:
        if v is not None and not (dt.date(2000, 1, 1) <= v <= dt.date(2100, 1, 1)):
            raise ValueError("Expiry date looks wrong")
        return v


class ItemPatch(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: Annotated[str, StringConstraints(min_length=1, max_length=60)] | None = None
    quantity: float | None = Field(default=None, ge=0, le=100_000)
    unit: Annotated[str, StringConstraints(max_length=24)] | None = None
    category: str | None = None
    expires_on: dt.date | None = None
    clear_expiry: bool = False

    @field_validator("category")
    @classmethod
    def _cat(cls, v: str | None) -> str | None:
        return _valid_category(v)


class BulkIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[ItemIn] = Field(min_length=1, max_length=40)


class ConsumeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[int] = Field(min_length=1, max_length=60)
    today: dt.date | None = None


def resolve_today(today: dt.date | None) -> dt.date:
    """Use the browser's local date when it is plausible, else UTC today."""
    server = utcnow().date()
    if today is not None and abs((today - server).days) <= 1:
        return today
    return server


def out(item: PantryItem, today: dt.date) -> dict:
    days_left = (item.expires_on - today).days if item.expires_on else None
    status = "none"
    if days_left is not None:
        status = "expired" if days_left < 0 else "soon" if days_left <= EXPIRING_DAYS else "ok"
    return {
        "id": item.id,
        "name": item.name,
        "quantity": item.quantity,
        "unit": item.unit,
        "category": item.category,
        "expires_on": item.expires_on.isoformat() if item.expires_on else None,
        "days_left": days_left,
        "status": status,
    }


def _owned(db: Session, uid: int, item_id: int) -> PantryItem:
    item = db.scalar(select(PantryItem).where(PantryItem.id == item_id, PantryItem.user_id == uid))
    if item is None:
        raise HTTPException(404, "Pantry item not found.")
    return item


def user_pantry(db: Session, uid: int) -> list[PantryItem]:
    return list(db.scalars(select(PantryItem).where(PantryItem.user_id == uid)).all())


@router.get("")
def list_items(
    today: dt.date | None = Query(default=None), ctx: AuthContext = Depends(require_auth), db: Session = Depends(get_db)
):
    t = resolve_today(today)
    items = user_pantry(db, ctx.user.id)
    items.sort(key=lambda i: (i.expires_on is None, i.expires_on or dt.date.max, i.name.lower()))
    rows = [out(i, t) for i in items]
    return {
        "items": rows,
        "categories": CATEGORY_NAMES,
        "expiring": [r for r in rows if r["status"] in ("soon", "expired")],
    }


def _add(db: Session, uid: int, body: ItemIn) -> PantryItem:
    item = PantryItem(
        user_id=uid,
        name=body.name,
        quantity=body.quantity,
        unit=body.unit,
        category=body.category or categorize(body.name),
        expires_on=body.expires_on,
    )
    db.add(item)
    return item


def _check_capacity(db: Session, uid: int, adding: int) -> None:
    count = db.scalar(select(func.count()).select_from(PantryItem).where(PantryItem.user_id == uid)) or 0
    if count + adding > MAX_ITEMS:
        raise HTTPException(409, f"Your pantry can hold up to {MAX_ITEMS} items.")


@router.post("", status_code=201)
def add_item(body: ItemIn, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    _check_capacity(db, ctx.user.id, 1)
    item = _add(db, ctx.user.id, body)
    db.commit()
    return out(item, resolve_today(None))


@router.post("/bulk", status_code=201)
def add_bulk(body: BulkIn, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    _check_capacity(db, ctx.user.id, len(body.items))
    items = [_add(db, ctx.user.id, i) for i in body.items]
    db.commit()
    t = resolve_today(None)
    return [out(i, t) for i in items]


@router.patch("/{item_id}")
def patch_item(item_id: int, body: ItemPatch, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    item = _owned(db, ctx.user.id, item_id)
    data = body.model_dump(exclude_unset=True)
    for key in ("name", "quantity", "unit", "category", "expires_on"):
        if key in data:
            setattr(item, key, data[key] if key != "name" else clean_text(data[key]))
    if body.clear_expiry:
        item.expires_on = None
    db.commit()
    return out(item, resolve_today(None))


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: int, response: Response, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    db.delete(_owned(db, ctx.user.id, item_id))
    db.commit()
    response.status_code = 204
    return response


@router.post("/consume")
def consume(body: ConsumeIn, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    """Remove used-up items. Items used within EXPIRING_DAYS of expiry count as rescued."""
    t = resolve_today(body.today)
    items = db.scalars(select(PantryItem).where(PantryItem.user_id == ctx.user.id, PantryItem.id.in_(set(body.ids)))).all()
    rescued = sum(1 for i in items if i.expires_on and 0 <= (i.expires_on - t).days <= EXPIRING_DAYS)
    for i in items:
        db.delete(i)
    user = db.get(User, ctx.user.id)
    user.rescued_count += rescued
    db.commit()
    return {"removed": len(items), "rescued": rescued, "rescued_total": user.rescued_count}
