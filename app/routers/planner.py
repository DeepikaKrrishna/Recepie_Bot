"""Weekly meal planner and the consolidated shopping list."""

from __future__ import annotations

import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..auth import AuthContext, require_auth, require_csrf
from ..db import get_db
from ..kitchen import categorize, consolidate, find_match, normalize_name, normalize_unit
from ..models import MealPlanEntry, PantryItem, ShoppingItem
from ..schemas import clean_text
from .cookbook import owned, summary

router = APIRouter(prefix="/api", tags=["planner"])

Slot = Literal["breakfast", "lunch", "dinner", "snack"]
SLOTS: list[str] = ["breakfast", "lunch", "dinner", "snack"]
MAX_SHOPPING = 400


def week_bounds(start: dt.date) -> tuple[dt.date, dt.date]:
    return start, start + dt.timedelta(days=6)


def _check_date(d: dt.date) -> dt.date:
    if not (dt.date(2000, 1, 1) <= d <= dt.date(2100, 1, 1)):
        raise ValueError("Date out of range")
    return d


class PlanIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day: dt.date
    slot: Slot
    recipe_id: int
    servings: int = Field(default=2, ge=1, le=20)

    @field_validator("day")
    @classmethod
    def _d(cls, v: dt.date) -> dt.date:
        return _check_date(v)


class MoveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day: dt.date
    slot: Slot

    @field_validator("day")
    @classmethod
    def _d(cls, v: dt.date) -> dt.date:
        return _check_date(v)


def entry_out(e: MealPlanEntry) -> dict:
    return {"id": e.id, "day": e.day.isoformat(), "slot": e.slot, "servings": e.servings, "recipe": summary(e.recipe)}


def _week(db: Session, uid: int, start: dt.date) -> list[MealPlanEntry]:
    a, b = week_bounds(start)
    return list(
        db.scalars(
            select(MealPlanEntry)
            .where(MealPlanEntry.user_id == uid, MealPlanEntry.day >= a, MealPlanEntry.day <= b)
            .order_by(MealPlanEntry.day)
        ).all()
    )


@router.get("/plan")
def get_plan(start: dt.date = Query(...), ctx: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    _check_date(start)
    return {"start": start.isoformat(), "slots": SLOTS, "entries": [entry_out(e) for e in _week(db, ctx.user.id, start)]}


@router.put("/plan")
def set_slot(body: PlanIn, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    owned(db, ctx.user.id, body.recipe_id)  # 404 unless the recipe is the user's
    entry = db.scalar(
        select(MealPlanEntry).where(
            MealPlanEntry.user_id == ctx.user.id, MealPlanEntry.day == body.day, MealPlanEntry.slot == body.slot
        )
    )
    if entry is None:
        entry = MealPlanEntry(user_id=ctx.user.id, day=body.day, slot=body.slot)
        db.add(entry)
    entry.recipe_id = body.recipe_id
    entry.servings = body.servings
    db.commit()
    db.refresh(entry)
    return entry_out(entry)


def _owned_entry(db: Session, uid: int, entry_id: int) -> MealPlanEntry:
    e = db.scalar(select(MealPlanEntry).where(MealPlanEntry.id == entry_id, MealPlanEntry.user_id == uid))
    if e is None:
        raise HTTPException(404, "Plan entry not found.")
    return e


@router.post("/plan/{entry_id}/move")
def move_entry(entry_id: int, body: MoveIn, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    """Move a meal to another slot; swaps with whatever is already there."""
    e = _owned_entry(db, ctx.user.id, entry_id)
    if (e.day, e.slot) == (body.day, body.slot):
        return entry_out(e)
    other = db.scalar(
        select(MealPlanEntry).where(
            MealPlanEntry.user_id == ctx.user.id, MealPlanEntry.day == body.day, MealPlanEntry.slot == body.slot
        )
    )
    old_day, old_slot = e.day, e.slot
    if other is not None:
        # Park `other` on a temporary slot to avoid tripping the unique constraint mid-swap.
        other.slot = "__swap__"
        db.flush()
    e.day, e.slot = body.day, body.slot
    db.flush()
    if other is not None:
        other.day, other.slot = old_day, old_slot
    db.commit()
    return entry_out(e)


@router.delete("/plan/{entry_id}", status_code=204)
def delete_entry(entry_id: int, response: Response, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    db.delete(_owned_entry(db, ctx.user.id, entry_id))
    db.commit()
    response.status_code = 204
    return response


# ---- shopping list ------------------------------------------------------------------------


class ShopIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    quantity: float | None = Field(default=None, ge=0, le=100_000)
    unit: Annotated[str, StringConstraints(max_length=24)] = ""
    source: Annotated[str, StringConstraints(max_length=80)] = ""


class ShopBulkIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[ShopIn] = Field(min_length=1, max_length=60)


class ShopPatch(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    checked: bool | None = None
    name: Annotated[str, StringConstraints(min_length=1, max_length=80)] | None = None
    quantity: float | None = Field(default=None, ge=0, le=100_000)


class FromPlanIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: dt.date
    skip_pantry: bool = True


def shop_out(s: ShoppingItem) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "quantity": s.quantity,
        "unit": s.unit,
        "category": s.category,
        "checked": s.checked,
        "source": s.source,
    }


def _shopping(db: Session, uid: int) -> list[ShoppingItem]:
    return list(
        db.scalars(
            select(ShoppingItem)
            .where(ShoppingItem.user_id == uid)
            .order_by(ShoppingItem.checked, ShoppingItem.category, ShoppingItem.name)
        ).all()
    )


def _capacity(db: Session, uid: int, adding: int) -> None:
    n = db.scalar(select(func.count()).select_from(ShoppingItem).where(ShoppingItem.user_id == uid)) or 0
    if n + adding > MAX_SHOPPING:
        raise HTTPException(409, f"Your shopping list can hold up to {MAX_SHOPPING} items.")


def merge_into_list(db: Session, uid: int, rows: list[tuple[str, float | None, str, str]]) -> int:
    """Add rows, merging with unchecked items of the same ingredient and unit. Returns rows added or merged."""
    existing = [s for s in _shopping(db, uid) if not s.checked]
    added = 0
    for line in consolidate(rows):
        match = next(
            (
                s
                for s in existing
                if normalize_name(s.name) == normalize_name(line.name) and normalize_unit(s.unit) == normalize_unit(line.unit)
            ),
            None,
        )
        if match is not None:
            if match.quantity is not None and line.quantity is not None:
                match.quantity = round(match.quantity + line.quantity, 2)
            src = ", ".join(dict.fromkeys(filter(None, [match.source, *line.sources])))
            match.source = src[:80]
        else:
            _capacity(db, uid, 1)
            item = ShoppingItem(
                user_id=uid,
                name=line.name[:80],
                quantity=line.quantity,
                unit=line.unit,
                category=categorize(line.name),
                source=", ".join(line.sources)[:80],
            )
            db.add(item)
            existing.append(item)
        added += 1
    return added


@router.get("/shopping")
def list_shopping(ctx: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    return [shop_out(s) for s in _shopping(db, ctx.user.id)]


@router.post("/shopping", status_code=201)
def add_shopping(body: ShopIn, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    merge_into_list(db, ctx.user.id, [(clean_text(body.name), body.quantity, body.unit, body.source)])
    db.commit()
    return [shop_out(s) for s in _shopping(db, ctx.user.id)]


@router.post("/shopping/bulk", status_code=201)
def add_shopping_bulk(body: ShopBulkIn, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    n = merge_into_list(db, ctx.user.id, [(clean_text(i.name), i.quantity, i.unit, i.source) for i in body.items])
    db.commit()
    return {"added": n, "items": [shop_out(s) for s in _shopping(db, ctx.user.id)]}


@router.patch("/shopping/{item_id}")
def patch_shopping(item_id: int, body: ShopPatch, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    s = db.scalar(select(ShoppingItem).where(ShoppingItem.id == item_id, ShoppingItem.user_id == ctx.user.id))
    if s is None:
        raise HTTPException(404, "Item not found.")
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(s, key, clean_text(value) if key == "name" else value)
    db.commit()
    return shop_out(s)


@router.delete("/shopping/{item_id}", status_code=204)
def delete_shopping(item_id: int, response: Response, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    s = db.scalar(select(ShoppingItem).where(ShoppingItem.id == item_id, ShoppingItem.user_id == ctx.user.id))
    if s is None:
        raise HTTPException(404, "Item not found.")
    db.delete(s)
    db.commit()
    response.status_code = 204
    return response


@router.delete("/shopping", status_code=204)
def clear_shopping(
    response: Response, checked_only: bool = True, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)
):
    stmt = delete(ShoppingItem).where(ShoppingItem.user_id == ctx.user.id)
    if checked_only:
        stmt = stmt.where(ShoppingItem.checked.is_(True))
    db.execute(stmt)
    db.commit()
    response.status_code = 204
    return response


@router.post("/shopping/from-plan")
def shopping_from_plan(body: FromPlanIn, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    """Turn a week's meal plan into one consolidated list, skipping what's already in the pantry."""
    _check_date(body.start)
    entries = _week(db, ctx.user.id, body.start)
    if not entries:
        raise HTTPException(422, "Plan some meals for this week first.")
    pantry_names = [p.name for p in db.scalars(select(PantryItem).where(PantryItem.user_id == ctx.user.id)).all()]
    rows, skipped = [], set()
    for e in entries:
        data = e.recipe.data or {}
        base = max(1, int(data.get("servings") or 1))
        factor = e.servings / base
        for ing in data.get("ingredients", []):
            name = ing.get("name", "")
            if not name:
                continue
            if body.skip_pantry and find_match(name, pantry_names):
                skipped.add(name.lower())
                continue
            qty = ing.get("quantity")
            rows.append(
                (
                    name,
                    round(qty * factor, 2) if isinstance(qty, int | float) else None,
                    ing.get("unit") or "",
                    e.recipe.title[:40],
                )
            )
    added = merge_into_list(db, ctx.user.id, rows) if rows else 0
    db.commit()
    return {"added": added, "skipped_in_pantry": sorted(skipped), "items": [shop_out(s) for s in _shopping(db, ctx.user.id)]}


@router.post("/shopping/to-pantry")
def shopping_to_pantry(ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    """Move ticked-off shopping items into the pantry."""
    checked = [s for s in _shopping(db, ctx.user.id) if s.checked]
    from .pantry import _check_capacity

    _check_capacity(db, ctx.user.id, len(checked))
    for s in checked:
        db.add(
            PantryItem(
                user_id=ctx.user.id,
                name=s.name[:60],
                quantity=s.quantity,
                unit=s.unit[:24],
                category=s.category if s.category else categorize(s.name),
            )
        )
        db.delete(s)
    db.commit()
    return {"moved": len(checked)}
