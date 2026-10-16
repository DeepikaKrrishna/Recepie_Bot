# Verification report

*17 Oct 2026 · branch `production-hardening` · app version 0.2.0*

## Summary

| Check | Result |
|---|---|
| Backend tests, SQLite | **164 passed** (Python 3.13.16; the Stage 1 suite was also verified on 3.11.17, and CI runs both) |
| Backend tests, PostgreSQL 16 | **164 passed** (also wired into CI's `postgres` job) |
| Migrations | `alembic upgrade head`, `check`, `downgrade base`, `upgrade head` all clean on SQLite and PostgreSQL 16 |
| Lint / format | `ruff check` and `ruff format --check` clean |
| Dependency audit | `pip-audit -r requirements.txt`: no known vulnerabilities |
| Browser journeys | Desktop (dark and light) and mobile (light and dark), 20+ steps each: **pass, 0 console errors** |
| Accessibility | axe-core 4.14, WCAG 2.1 A/AA + best practice, 11 pages × 2 themes: **0 violations** |
| Secrets in tree | None (test guard + `git grep`) |
| Secrets in history | **Still present** in commit `25c65d6`. Revocation is required (AUDIT §7) |
| Live OpenRouter | **Not run.** No valid key, and the provider is unreachable from the build sandbox |
| Deployment | **Not deployed.** `render.yaml` (web + Postgres) and `Procfile` are prepared; there is no demo URL |

**Production-ready? Not yet.** Code, persistence, security controls and tests are in place. Remaining gates:
1. Revoke the leaked keys.
2. Run a live-provider smoke test.
3. Deploy, then check `/readyz` and run the e2e suite against the deployed URL.
4. Confirm database backups are on.

## Feature checklist

| Phase | Feature | Implemented | Verified by |
|---|---|---|---|
| 1 | Audit, secrets removed from tree | ✅ | `docs/AUDIT.md`, key guard test |
| 2 | Landing, chips + suggestions, filters, cards with art, detail pages, skeletons, empty/error states, keyboard nav, dark mode | ✅ | e2e journeys, axe |
| 2 | Favorites, cookbook, pantry dashboard, weekly planner, auth screens | ✅ | e2e journeys |
| 3 | Structured generation with server validation, multi-recipe, servings scaling, substitutions, remix/variations | ✅ | `test_generation.py`, `test_resilience.py`, e2e |
| 3 | Exclusions, diet, cuisine, time, difficulty, budget, occasion, spice | ✅ | `test_generation.py`, `test_kitchen.py` |
| 3 | Timeouts, bounded retries, rate limits, model fallback, malformed output | ✅ | `test_resilience.py` |
| 4 | Signup/login/logout, argon2id, secure sessions, CSRF, authorization | ✅ | `test_accounts.py` |
| 4 | Users, saved recipes, favorites, pantry + expiry, preferences, meal plans, shopping lists, history with retention | ✅ | `test_accounts.py`, `test_kitchen.py`, `test_migrations.py` |
| 4 | SQLite dev / PostgreSQL prod, migrations, transactions | ✅ | PostgreSQL run, migration checks |
| 4 | Account deletion + data cleanup, data export | ✅ | `test_account_deletion_removes_everything`, `test_export_contains_only_own_data` |
| 5.1 | Smart Pantry | ✅ | `test_pantry_*`, e2e |
| 5.2 | Food Waste Reducer (rescue mode + rescued counter) | ✅ | `test_rescue_mode_*`, `test_consume_counts_rescued_items`, e2e |
| 5.3 | Indian Cuisine Mode (regional cuisines, Jain/eggetarian, tiffin, INR) | ✅ | options + validation tests |
| 5.4 | Budget Chef (budget filter, per-serving estimate, labelled) | ✅ (AI estimates only) | `test_time_and_budget_notices` |
| 5.5 | Recipe Remix | ✅ | `test_remix_request_is_forwarded`, UI |
| 5.6 | Meal Planner + consolidated shopping list | ✅ | `test_plan_*`, `test_shopping_*`, e2e |
| 5.7 | Nutrition estimates | ⚠️ AI estimates, labelled unverified; no nutrition database | — |
| 5.8 | Voice controls | ✅ (progressive enhancement) | Manual code path; not automatable in headless Chromium |
| 5.8 | Image ingredient recognition | ❌ deferred | — |
| 6 | Validation, SQLi (ORM only), XSS, CSRF, authz, request limits, rate limits, logs, health, privacy, terms, food-safety notices | ✅ | `test_security.py`, `test_accounts.py` |
| 7 | Tests, CI, deploy config, migrations on deploy, deploy only after checks pass | ✅ | `.github/workflows/ci.yml`, `render.yaml` |
| 8 | README with architecture, setup, env, migrations, tests, deploy, security, limitations | ✅ | `README.md` |

## Not verified here

- Live AI quality and latency with real OpenRouter models.
- Speech recognition, read-aloud and wake lock on real phones. These are feature-detected and hidden when unsupported.
- Service-worker offline behaviour across browsers. It's registered and caches the shell, but offline was not exercised end to end.
- Load and performance under concurrent users.
