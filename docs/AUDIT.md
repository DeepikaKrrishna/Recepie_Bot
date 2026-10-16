# Recipe Bot: repository audit

*Audit date: 16 Oct 2026 · Baseline: `main` @ `50ee280` (3 commits, ~1,150 lines)*

Secret values are never reproduced in this document.

---

## 1. Existing functionality (baseline)

| Area | What existed | State at audit |
|---|---|---|
| Backend | FastAPI app in `main.py` with three routes | Ran locally |
| `GET /suggest` | Cosine-similarity ingredient matcher over a 20-row `recipes.csv` (`ml_model.py`) | Worked; returned unrelated "popular" recipes when nothing matched, without saying so |
| `POST /generate` | Streams a markdown recipe from OpenRouter (`google/gemma-3-4b-it:free`) over SSE | Worked when the key and model were valid |
| `POST /ask` | "Ask the Chef" non-streaming Q&A | Crashed (500) on any non-JSON provider response |
| Frontend | `index.html` with inline CSS/JS: input, voice button, dark mode, quick suggestions, streamed recipe, Q&A | Had to be opened as a file; hardcoded `http://127.0.0.1:8001` |
| `app.js`, `style.css` | Older copies of the frontend | **Not referenced by `index.html`** (dead code). `app.js` defines `getSuggestions`/`askQuestion` **three times**; the last (stub) versions win |
| Tests | 8 `test_*.py`/probe scripts | Not tests. They were manual scripts that call the live API, and six contained API keys. `pytest` would have collected them and made paid network calls |
| Docs | Two-line README | No setup, env or deploy instructions |

## 2. Security issues

| # | Severity | Issue | Status |
|---|---|---|---|
| S1 | **Critical** | **Two distinct OpenRouter API keys committed.** One is in `.env` (tracked), and a second is hardcoded in `main.py` and five probe scripts. Both are in public Git history (commit `25c65d6`). `main.py` ignored `.env` entirely | Removed from the tree in `ddf098b`. **Keys must be revoked; see §7** |
| S2 | High | **Stored XSS from model output:** `marked.parse()` output was written to `innerHTML` unsanitised. A prompt-injected title could make the model emit `<img onerror=…>` | Fixed: everything renders via `textContent`; CSP `script-src 'self'` |
| S3 | High | No rate limiting on paid AI endpoints, and no input length limits (unbounded prompt cost, easy key-quota exhaustion) | Fixed: per-IP limiter, Pydantic limits, 16 KB body cap |
| S4 | Medium | Provider error bodies forwarded verbatim to the browser (`API error 401: …`) | Fixed: mapped to safe messages |
| S5 | Medium | CORS `allow_origins=["*"]` combined with `allow_credentials=True` | Fixed: closed by default, configurable, no credentials |
| S6 | Medium | No timeouts or retries policy on `/ask`; no overall deadline | Fixed: timeouts, bounded retries, 90 s deadline |
| S7 | Low | User text interpolated directly into prompts (prompt injection) | Mitigated: constraints sent as JSON data, system rules, server-side output checks |
| S8 | Low | `marked` loaded unpinned from a CDN (`/npm/marked/marked.min.js`) | Removed; no third-party scripts |
| S9 | Info | No security headers, health endpoint or structured logs | Added |

## 3. Bugs and code-quality issues

| # | Issue | Status |
|---|---|---|
| B1 | Frontend not served by the backend (`GET /` → 404); port mismatch (8000 vs 8001) | Fixed: app serves `static/`, same-origin API |
| B2 | Triple-defined functions in `app.js`; duplicate CSS | Dead files removed; logic consolidated in `static/js/app.js` |
| B3 | Recipe output was free-form markdown, so it couldn't be scaled, validated or saved | Replaced by a validated JSON schema (legacy stream kept) |
| B4 | `/suggest` presented unrelated recipes as matches, and ignored diet | Now returns `fallback: true` and filters by diet/exclusions |
| B5 | Voice input threw in browsers without `SpeechRecognition` | Feature-detected; button hidden when unsupported |
| B6 | `/ask` 500s when the provider returns non-JSON or an error object | Fixed |
| B7 | Streaming parser in `app.js` didn't buffer partial SSE frames (fixed in `index.html` but not `app.js`) | Moot: dead file removed |
| B8 | Dependencies pinned to versions from 2023; no dev/test deps | Updated, pinned, `pip-audit` clean |
| B9 | Unused imports (`Request`, `os` in places) | Removed (ruff) |

## 4. Proposed architecture

```
Browser (static HTML/CSS/JS, same origin)
   │  JSON over HTTPS
   ▼
FastAPI app (app/main.py)
   ├─ SecurityMiddleware: body limit · CSP/headers · request-id · JSON logs
   ├─ Rate limiter (per IP, AI endpoints)
   ├─ Routes: /api/* · legacy /suggest /generate /ask · /healthz /readyz · static
   ├─ recipes.py: prompts → JSON extraction → Pydantic validation → safety checks
   ├─ llm.py: OpenRouter client (timeouts, retries, fallback models, error mapping)
   ├─ recommender.py: local dataset matcher (no network)
   └─ [Stage 2] db/: SQLAlchemy models · Alembic migrations · auth/session/CSRF
           │
           ▼
   SQLite (dev) / PostgreSQL (prod)
```

**Why keep FastAPI + vanilla JS:** the existing stack is fit for purpose. A framework migration (React/Next, Django) would add a build step and risk without fixing any audited problem. The frontend uses no build tooling, so it deploys as static files from the same service.

**Decision: in-process rate limiter.** Fine for a single instance. When scaling past one instance, swap `RateLimiter` for Redis (the interface is isolated in `security.py`).

## 5. File structure (implemented)

```
app/                  application package
  config.py           env settings (secrets never logged/repr'd)
  schemas.py          request + AI-output models
  llm.py              OpenRouter client + JSON extraction
  recipes.py          generation, validation, diet/exclusion/allergen rules
  recommender.py      local dataset matcher (was ml_model.py)
  security.py         middleware, logging, rate limiter
  main.py             app factory + routes
static/               frontend (index, privacy, terms, css, js)
data/recipes.csv      local recipe dataset
tests/                pytest suite + fake OpenRouter transport
scripts/              check_openrouter.py · run_mock_server.py
docs/                 this audit, verification report, screenshots
main.py               entry point (uvicorn main:app)
render.yaml, Procfile deployment
.github/workflows/ci.yml
```

## 6. Database schema (proposed for Stage 2; not yet implemented)

SQLAlchemy 2.0 models with Alembic migrations; SQLite locally, PostgreSQL in production. Every user-owned table carries `user_id` with `ON DELETE CASCADE`, and every query is scoped by the authenticated user.

| Table | Key columns |
|---|---|
| `users` | id (uuid), email (unique, citext), password_hash (argon2id), created_at, deleted_at |
| `sessions` | id (random 256-bit, hashed at rest), user_id, created_at, expires_at, user_agent_hash |
| `user_preferences` | user_id (pk), diets (json), cuisines (json), default_servings, currency, history_retention_days |
| `pantry_items` | id, user_id, name, quantity, unit, expires_on (date, nullable), category, updated_at · index (user_id, expires_on) |
| `recipes` | id, user_id, title, payload (json: the validated `Recipe`), source (`ai`/`dataset`), model, created_at |
| `favorites` | user_id, recipe_id (composite pk), created_at |
| `meal_plans` | id, user_id, week_start (date) · unique (user_id, week_start) |
| `meal_plan_entries` | id, meal_plan_id, day (0–6), slot (`breakfast`/`lunch`/`dinner`/`snack`), recipe_id, servings |
| `shopping_lists` | id, user_id, meal_plan_id (nullable), created_at |
| `shopping_list_items` | id, list_id, name, quantity, unit, checked |
| `generation_history` | id, user_id, request (json, no free-text PII beyond ingredients), recipe_ids (json), created_at, expires_at · nightly purge |

Account deletion is one transaction: it deletes the user row (cascades everything) and revokes sessions.

## 7. Credential remediation (action required by the repo owner)

1. **Revoke both keys now** at https://openrouter.ai/settings/keys. Anyone could have copied them from the public history since April 2026. Check the key's activity/usage page for unexpected spend.
2. Create **one** new key and set an OpenRouter credit limit on it.
3. Locally: put it in `.env` (git-ignored). In production: set `OPENROUTER_API_KEY` in the host's environment settings.
4. Optional history clean-up (doesn't replace revocation): `git filter-repo --replace-text` to scrub the old values, then force-push and ask collaborators to re-clone. Old forks and clones keep the history.
5. Turn on **GitHub secret scanning + push protection** (free for public repos): Settings → Code security.

## 8. Prioritised backlog

**Done in this pass (Stage 0–1)**: S1–S9, B1–B9, structured generation, filters, scaling, substitutions, remix, Indian regional cuisines, budget input with labelled estimates, privacy/terms, tests, CI, deploy config.

| Priority | Item | Notes |
|---|---|---|
| P0 | Revoke leaked keys (owner) | §7 |
| P0 | First real-provider smoke test | Needs the new key; run `python scripts/check_openrouter.py`, then a manual generate. Confirm the default free model still exists, or set `OPENROUTER_MODEL` |
| P1 | **Stage 2: accounts + persistence** | SQLAlchemy/Alembic, argon2id hashing, server-side sessions (HttpOnly, Secure, SameSite=Lax), CSRF double-submit token, saved recipes, favorites, preferences, account deletion, history retention |
| P1 | Smart Pantry | CRUD with quantities and expiry |
| P1 | Food Waste Reducer | Pass soon-to-expire pantry items as "use first" constraints; rank by overlap |
| P2 | Meal Planner + shopping list | Weekly grid; consolidate units (needs a small unit-conversion table) |
| P2 | Shared rate limit store (Redis) | Needed when running more than one instance |
| P2 | Nutrition from a real database | e.g. USDA FoodData Central or IFCT (India) mapping. Until then, AI values stay labelled "unverified" |
| P2 | Budget Chef with real price data | Currently AI estimate only |
| P3 | Larger local dataset with Indian recipes | 20 rows today, mostly Western |
| P3 | Accessibility audit with axe + screen reader pass | Basics in place (labels, focus, contrast, reduced motion) |
| P3 | Voice controls, image ingredient recognition | After core launch is stable |
| — | License | **Not added.** Owner must choose (e.g. MIT) |

---

## 9. Status update (17 Oct 2026)

Everything in §8 marked P1 and P2 is now implemented. See `docs/VERIFICATION.md` for evidence:

- **Stage 2 (accounts & persistence):** SQLAlchemy 2 + Alembic, argon2id, hashed server-side sessions, CSRF + Origin checks, preferences, history with retention, export, account deletion.
- **Smart Pantry & Food Waste Reducer:** expiry tracking, rescue-mode generation ranked by expiring items used, rescued-items counter.
- **Meal Planner & shopping list:** weekly grid with move/swap, aisle-grouped list consolidated from the plan, skips pantry items, bought → pantry.
- **Extras beyond the brief:**
  - Cook Mode (voice, read-aloud, timers, wake lock)
  - public share links
  - pantry-coverage badges
  - PWA / offline
  - generative plate art
  - occasion and spice filters
  - axe-clean UI

Still open: revoke the keys (P0, owner); a live-provider smoke test and first deploy (P0); Redis rate limiting; nutrition and price data sources; password reset email; image ingredient recognition; a larger local dataset; and a license.
