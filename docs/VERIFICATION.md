# Verification report: Stages 0–1

*16 Oct 2026 · branch `production-hardening` · app version 0.2.0*

## Summary

| Area | Result |
|---|---|
| Automated tests | **90 passed** on Python 3.13.16 and 3.11.17 |
| Lint / format | `ruff check` and `ruff format --check` clean |
| Dependency audit | `pip-audit -r requirements.txt`: no known vulnerabilities |
| Secrets in current tree | None (`git grep`, plus a test that guards against re-adding them) |
| Secrets in Git history | **Still present** (commit `25c65d6`). Revocation required; see AUDIT §7 |
| Browser end-to-end (mock AI) | Passed at 390 px (light) and 1280 px (dark): chips, filters, quick matches, generate, detail, scaling, substitutes, back navigation, Ask the Chef. No console or CSP errors, no horizontal scroll |
| Production-mode boot without key | Starts; `/readyz` reports `degraded`; AI endpoints return 503 with a clear message; HSTS + CSP present; `/docs` hidden |
| Live OpenRouter call | **Not run.** No valid key was available, OpenRouter isn't reachable from the build sandbox, and the leaked keys must not be used |
| Deployment | **Not deployed.** Config prepared (`render.yaml`, `Procfile`). No demo URL exists |

**Production-ready? No, not yet.** Remaining gates: revoke the keys, run a live-provider smoke test, deploy, and complete Stage 2 (accounts and persistence) plus its security tests.

## Implemented and verified

| Requirement | Evidence |
|---|---|
| Secrets out of code; key server-side only; env-configurable model | `app/config.py`; tests `test_api_key_sent_only_to_provider_and_never_returned`, `test_model_is_configurable`, `test_settings_repr_hides_key`, `test_no_secrets_committed_in_tree` |
| Structured recipe output validated on the server | `app/schemas.py`; `tests/test_resilience.py` parse/schema tests |
| Malformed output, provider errors, timeouts, rate limits, unavailable models | `test_resilience.py`: 5xx retry, bounded retries, 429, timeout→504, connect→503, 401 no-retry, model fallback, `response_format` downgrade |
| Exclusions and diet respected | `test_excluded_ingredient_recipe_is_dropped`, `test_diet_violation_is_dropped`, `test_rules.py` |
| Allergens never claimed absent; estimates labelled | Server keyword detection plus UI copy; `test_server_detects_allergens…` |
| Scaling, substitutions, remix | E2E (2→4 servings: 2 cups→4 cups, ¼ tsp→½ tsp); `test_substitutes*`, `test_remix_request_is_forwarded` |
| Input validation, request size limits | `test_generate_rejects_invalid_input` (13 cases), `test_oversized_*` (Content-Length and chunked) |
| Rate limiting on AI endpoints; X-Forwarded-For spoofing | `test_ai_endpoints_are_rate_limited`, `test_forwarded_for_*` |
| XSS: no HTML parsing of dynamic data; strict CSP | `test_frontend_never_uses_innerhtml_with_data`, `test_security_headers_present` |
| CORS closed by default | `test_cors_*` |
| Health checks | `test_health_endpoints`, Render `healthCheckPath: /healthz` |
| Legacy endpoints preserved | `test_legacy_endpoints_still_work` |
| CI never deploys on failure | GitHub Actions + `autoDeployTrigger: checksPass` (per Render docs) |

## Not implemented yet (deferred by design)

These are Stage 2 and later; see AUDIT §8. They aren't marked complete:

- Accounts (signup/login/logout, sessions, CSRF), database, migrations, account deletion
- Favorites and saved recipes, pantry with expiry, food-waste prioritisation, meal planner, shopping lists, generation history
- Nutrition from a verified data source; real price data
- Shared rate-limit store for multi-instance deployments
- License (the owner needs to decide)
