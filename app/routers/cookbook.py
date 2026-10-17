"""Cookbook: saved recipes, favourites, notes and cook tracking."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, StringConstraints, ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..auth import AuthContext, require_auth, require_csrf
from ..db import get_db
from ..models import SavedRecipe, User, utcnow
from ..schemas import RecipeOut

router = APIRouter(prefix="/api", tags=["cookbook"])

MAX_SAVED = 500


class SaveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recipe: dict
    favorite: bool = False


class PatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    favorite: bool | None = None
    notes: Annotated[str, StringConstraints(max_length=2000)] | None = None


def summary(r: SavedRecipe) -> dict:
    d = r.data or {}
    return {
        "id": r.id,
        "title": r.title,
        "hero_emoji": d.get("hero_emoji", ""),
        "description": d.get("description", ""),
        "cuisine": d.get("cuisine", ""),
        "diet_tags": d.get("diet_tags", []),
        "difficulty": d.get("difficulty"),
        "total_minutes": d.get("total_minutes"),
        "servings": d.get("servings"),
        "ingredients": d.get("ingredients", []),
        "favorite": r.favorite,
        "cooked_count": r.cooked_count,
        "created_at": r.created_at.isoformat(),
    }


def full(r: SavedRecipe) -> dict:
    return {
        **summary(r),
        "recipe": r.data,
        "notes": r.notes,
        "last_cooked_at": r.last_cooked_at.isoformat() if r.last_cooked_at else None,
    }


def owned(db: Session, user_id: int, recipe_id: int) -> SavedRecipe:
    # Filtering by owner returns 404 for other users' recipes, so ids can't be probed.
    r = db.scalar(select(SavedRecipe).where(SavedRecipe.id == recipe_id, SavedRecipe.user_id == user_id))
    if r is None:
        raise HTTPException(404, "Recipe not found.")
    return r


def validate_recipe_payload(raw: dict) -> dict:
    try:
        recipe = RecipeOut.model_validate(raw)
    except ValidationError:
        raise HTTPException(422, "That recipe is missing required details and can't be saved.") from None
    return recipe.model_dump(mode="json")


@router.get("/recipes")
def list_recipes(
    favorite: bool | None = None,
    q: Annotated[str, Query(max_length=80)] = "",
    ctx: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    stmt = select(SavedRecipe).where(SavedRecipe.user_id == ctx.user.id)
    if favorite is not None:
        stmt = stmt.where(SavedRecipe.favorite == favorite)
    if q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(SavedRecipe.title).like(like), func.lower(SavedRecipe.notes).like(like)))
    rows = db.scalars(stmt.order_by(SavedRecipe.favorite.desc(), SavedRecipe.created_at.desc()).limit(MAX_SAVED)).all()
    return [summary(r) for r in rows]


@router.post("/recipes", status_code=201)
def save_recipe(body: SaveIn, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    data = validate_recipe_payload(body.recipe)
    count = db.scalar(select(func.count()).select_from(SavedRecipe).where(SavedRecipe.user_id == ctx.user.id)) or 0
    if count >= MAX_SAVED:
        raise HTTPException(409, f"Your cookbook is full ({MAX_SAVED} recipes). Remove some to save more.")
    r = SavedRecipe(user_id=ctx.user.id, title=data["title"], data=data, favorite=body.favorite)
    db.add(r)
    db.commit()
    return full(r)


@router.get("/recipes/{recipe_id}")
def get_recipe(recipe_id: int, ctx: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    return full(owned(db, ctx.user.id, recipe_id))


@router.patch("/recipes/{recipe_id}")
def patch_recipe(recipe_id: int, body: PatchIn, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    r = owned(db, ctx.user.id, recipe_id)
    if body.favorite is not None:
        r.favorite = body.favorite
    if body.notes is not None:
        r.notes = body.notes
    db.commit()
    return full(r)


@router.delete("/recipes/{recipe_id}", status_code=204)
def delete_recipe(recipe_id: int, response: Response, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    db.delete(owned(db, ctx.user.id, recipe_id))
    db.commit()
    response.status_code = 204
    return response


@router.post("/recipes/{recipe_id}/cooked")
def mark_cooked(recipe_id: int, ctx: AuthContext = Depends(require_csrf), db: Session = Depends(get_db)):
    r = owned(db, ctx.user.id, recipe_id)
    r.cooked_count += 1
    r.last_cooked_at = utcnow()
    user = db.get(User, ctx.user.id)
    user.cooked_count += 1
    db.commit()
    return full(r)
