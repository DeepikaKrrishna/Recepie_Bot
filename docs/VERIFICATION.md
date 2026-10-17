# Verification report

*18 Oct 2026 · branch `launch-redesign` · Groq + Chef Run redesign*

## Summary

| Check | Result |
|---|---|
| Backend tests, SQLite | **138 passed** (Python 3.13.16; CI also runs 3.11) |
| Backend tests, PostgreSQL 16 | **138 passed** |
| Migrations | `0001 → 0002` upgrade, `alembic check`, downgrade and re-upgrade are clean on SQLite and PostgreSQL 16 |
| Lint / format | `ruff check` and `ruff format --check` clean |
| Dependency audit | `pip-audit -r requirements.txt`: no known vulnerabilities |
| Browser journeys | Desktop and mobile, each in light and dark mode. Steps: gate → sign up → generate → Chef Run → recipe → scale → swaps → save/favourite → Cook Mode → cookbook → stats → sign out. **All pass, 0 console errors** |
| Accessibility | axe-core 4.14, WCAG 2.1 A/AA + best practice, 10 screens × 2 themes (incl. the game): **0 violations** |
| Secrets in tree | None (test guard; `.env` is git-ignored) |
| Secrets in history | Old OpenRouter keys **still present** in commit `25c65d6`, so they must be revoked (AUDIT §7) |
| Live Groq API | **Not run.** The build sandbox cannot reach api.groq.com. AI paths are verified with a mocked provider only |
| Deployment | **Not deployed.** `render.yaml` (web + Postgres, deploys only after checks pass) is ready; there is no demo URL |

**Launch gates remaining:**
1. Revoke the leaked OpenRouter keys.
2. Add `GROQ_API_KEY`, run `python scripts/check_ai.py`, and generate a few recipes by hand to judge quality.
3. Deploy, then check `/readyz`.
4. Turn on database backups.

## Feature checklist

| Feature | Verified by |
|---|---|
| Sign-in gate (all app routes → `/welcome?next=…`, return after sign-in) | e2e journey |
| Groq provider (OpenAI-compatible), JSON mode, retries, model fallback, timeouts | `test_resilience.py`, `test_generation.py` |
| Quality prompt (real dishes, built around the user's ingredients, ≤3 extras, distinct ideas, cues in steps) | `test_generation.py` prompt assertions |
| Coverage ranking ("uses N of yours", "+N to buy") | `test_generation.py`, e2e |
| Diet / exclusion filtering, allergen notices | `test_generation.py` |
| AI endpoints signed-in only; rate limited | `test_generation.py` (sign-in), `test_security.py` (429) |
| Chef Run mini-game, ready button, best score saved | e2e journey, `test_accounts.py` (game-score) |
| Cook Mode (steps, keyboard, timers, finish → cooked count) | e2e journey |
| Cookbook (save, favourite, notes, cooked, delete, 500 cap) | `test_cookbook.py`, e2e |
| Account (profile, password change revokes sessions, export, delete) | `test_accounts.py`, e2e |
| Demo mode banner (canned recipes are flagged as such) | e2e screenshots |

## Not verified here

- Live recipe quality and latency with real Groq models.
- Speech recognition, read-aloud and wake lock on real phones (feature-detected; hidden when unsupported).
- Offline behaviour of the service worker across browsers.
- Load under many concurrent users. Groq free-tier limits will apply first.
