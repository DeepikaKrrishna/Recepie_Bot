"""Request and response models.

Every AI response is parsed into these models on the server before it reaches the
browser. Anything that does not validate is rejected, never shown.
"""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

# ---- shared primitives ---------------------------------------------------------

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_text(value: str) -> str:
    """Strip control characters and collapse whitespace."""
    return re.sub(r"\s+", " ", _CONTROL.sub("", value)).strip()


ShortText = Annotated[str, StringConstraints(min_length=1, max_length=60)]
IngredientName = Annotated[str, StringConstraints(min_length=1, max_length=60)]


class Difficulty(StrEnum):
    easy = "easy"
    medium = "medium"
    hard = "hard"


CUISINES = [
    "Any",
    "South Indian",
    "North Indian",
    "Bengali",
    "Gujarati",
    "Maharashtrian",
    "Kerala",
    "Chettinad",
    "Hyderabadi",
    "Punjabi",
    "Indo-Chinese",
    "Italian",
    "Mexican",
    "Chinese",
    "Thai",
    "Japanese",
    "Mediterranean",
    "Middle Eastern",
    "American",
    "French",
    "Korean",
]

OCCASIONS = [
    "quick weeknight",
    "tiffin box",
    "comfort food",
    "rainy-day snack",
    "party starter",
    "festive",
    "light & healthy",
    "kid-friendly",
    "date night",
    "one-pot",
]

DIETS = [
    "vegetarian",
    "vegan",
    "eggetarian",
    "jain",
    "gluten-free",
    "dairy-free",
    "nut-free",
    "high-protein",
    "low-carb",
    "diabetic-friendly",
]


def validate_diets(values: list[str]) -> list[str]:
    out: list[str] = []
    for v in values:
        v = v.strip().lower()
        if v not in DIETS:
            raise ValueError(f"Unsupported dietary preference: {v[:30]}")
        if v not in out:
            out.append(v)
    return out


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# ---- requests -----------------------------------------------------------------


class RemixRequest(StrictModel):
    base_title: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    instruction: Annotated[str, StringConstraints(min_length=1, max_length=200)]


class GenerateRequest(StrictModel):
    ingredients: list[IngredientName] = Field(default_factory=list, max_length=30)
    exclude: list[IngredientName] = Field(default_factory=list, max_length=20)
    dish: Annotated[str, StringConstraints(max_length=120)] | None = None
    cuisine: Annotated[str, StringConstraints(max_length=40)] = "Any"
    diets: list[str] = Field(default_factory=list, max_length=6)
    max_total_minutes: int | None = Field(default=None, ge=5, le=600)
    difficulty: Difficulty | None = None
    servings: int = Field(default=2, ge=1, le=20)
    budget: float | None = Field(default=None, gt=0, le=1_000_000)
    currency: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")] | None = None
    count: int = Field(default=3, ge=1, le=4)
    remix: RemixRequest | None = None
    use_first: list[IngredientName] = Field(default_factory=list, max_length=15)
    occasion: str | None = None
    spice: Literal["mild", "medium", "hot"] | None = None

    @field_validator("occasion")
    @classmethod
    def _occasion(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        match = next((o for o in OCCASIONS if o == value.strip().lower()), None)
        if match is None:
            raise ValueError("Unsupported occasion")
        return match

    @field_validator("ingredients", "exclude", "use_first")
    @classmethod
    def _clean_list(cls, items: list[str]) -> list[str]:
        seen: dict[str, str] = {}
        for item in items:
            text = clean_text(item)
            if text and text.lower() not in seen:
                seen[text.lower()] = text
        return list(seen.values())

    @field_validator("dish")
    @classmethod
    def _clean_dish(cls, value: str | None) -> str | None:
        value = clean_text(value) if value else None
        return value or None

    @field_validator("cuisine")
    @classmethod
    def _known_cuisine(cls, value: str) -> str:
        match = next((c for c in CUISINES if c.lower() == value.strip().lower()), None)
        if match is None:
            raise ValueError("Unsupported cuisine")
        return match

    @field_validator("diets")
    @classmethod
    def _known_diets(cls, values: list[str]) -> list[str]:
        return validate_diets(values)

    def has_subject(self) -> bool:
        return bool(self.ingredients or self.dish or self.remix or self.use_first)


class SubstituteRequest(StrictModel):
    recipe_title: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    ingredient: Annotated[str, StringConstraints(min_length=1, max_length=60)]
    diets: list[str] = Field(default_factory=list, max_length=6)
    reason: Annotated[str, StringConstraints(max_length=120)] | None = None

    @field_validator("diets")
    @classmethod
    def _known_diets(cls, values: list[str]) -> list[str]:
        return validate_diets(values)


class AskRequest(StrictModel):
    question: Annotated[str, StringConstraints(min_length=2, max_length=500)]


# ---- AI output (validated) ----------------------------------------------------


class Ingredient(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    name: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    quantity: float | None = Field(default=None, ge=0, le=100_000)
    unit: Annotated[str, StringConstraints(max_length=24)] | None = None
    note: Annotated[str, StringConstraints(max_length=120)] | None = None
    optional: bool = False


class Nutrition(BaseModel):
    """Per-serving AI estimate. Always presented as unverified."""

    model_config = ConfigDict(extra="ignore")
    calories: float | None = Field(default=None, ge=0, le=5000)
    protein_g: float | None = Field(default=None, ge=0, le=500)
    carbs_g: float | None = Field(default=None, ge=0, le=1000)
    fat_g: float | None = Field(default=None, ge=0, le=500)


class CostEstimate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    amount: float = Field(ge=0, le=10_000_000)
    currency: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]


class Recipe(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    title: Annotated[str, StringConstraints(min_length=2, max_length=120)]
    description: Annotated[str, StringConstraints(max_length=400)] = ""
    cuisine: Annotated[str, StringConstraints(max_length=40)] = ""
    diet_tags: list[Annotated[str, StringConstraints(max_length=30)]] = Field(default_factory=list, max_length=10)
    prep_minutes: int = Field(ge=0, le=1440)
    cook_minutes: int = Field(ge=0, le=2880)
    servings: int = Field(ge=1, le=50)
    difficulty: Difficulty
    ingredients: list[Ingredient] = Field(min_length=1, max_length=40)
    steps: list[Annotated[str, StringConstraints(min_length=3, max_length=600)]] = Field(min_length=1, max_length=40)
    allergens: list[Annotated[str, StringConstraints(max_length=40)]] = Field(default_factory=list, max_length=15)
    estimated_cost: CostEstimate | None = None
    nutrition_per_serving: Nutrition | None = None
    tips: list[Annotated[str, StringConstraints(max_length=300)]] = Field(default_factory=list, max_length=5)

    @field_validator("difficulty", mode="before")
    @classmethod
    def _norm_difficulty(cls, v):
        return v.strip().lower() if isinstance(v, str) else v


class RecipeBatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    recipes: list[Recipe] = Field(min_length=1, max_length=6)


class Substitute(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    name: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    ratio: Annotated[str, StringConstraints(max_length=80)] = ""
    notes: Annotated[str, StringConstraints(max_length=300)] = ""


class SubstituteBatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    substitutes: list[Substitute] = Field(min_length=1, max_length=6)


# ---- API responses ------------------------------------------------------------


class RecipeOut(Recipe):
    total_minutes: int = Field(ge=0, le=4320)
    possible_allergens: list[Annotated[str, StringConstraints(max_length=40)]] = Field(default_factory=list, max_length=20)
    notices: list[Annotated[str, StringConstraints(max_length=300)]] = Field(default_factory=list, max_length=10)
    uses_expiring: list[Annotated[str, StringConstraints(max_length=60)]] = Field(default_factory=list, max_length=15)


class GenerateResponse(BaseModel):
    recipes: list[RecipeOut]
    dropped: int = 0
    model: str
    disclaimer: str


class SubstituteResponse(BaseModel):
    ingredient: str
    substitutes: list[Substitute]
    model: str
    disclaimer: str


class AskResponse(BaseModel):
    answer: str
    model: str | None = None
