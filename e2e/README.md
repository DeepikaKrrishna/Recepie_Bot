# End-to-end checks

Two Node scripts drive a real Chromium against the app running with the **fake AI provider**
(no API key, no network):

- `journey.js` signs up, fills the pantry, runs a rescue search and a normal search, opens a
  recipe, scales it, saves and favourites it, adds missing items to the shopping list, asks for
  swaps, runs Cook Mode to the end, updates the pantry, shares a public link, plans a meal,
  builds and ticks off the shopping list, checks account stats, opens the share link signed
  out, and signs out. It fails on any browser console error.
- `a11y.js` runs axe-core (WCAG 2.1 A/AA + best practice) on 11 pages in light and dark themes
  and fails on any violation.

```bash
# terminal 1, from the repo root
DATABASE_URL=sqlite:///./e2e.sqlite3 python scripts/run_mock_server.py

# terminal 2
cd e2e && npm install && npx playwright install chromium
mkdir -p screenshots && npm test
```
