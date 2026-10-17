# End-to-end checks

Two Node scripts drive a real Chromium against the app running in **demo mode** (no API key, no network):

- `journey.js [desktop|mobile] [light|dark]`:
  - visits a page signed out and checks it's sent to the welcome screen
  - signs up and lands back on the page it asked for
  - adds ingredients, a mood and a diet, then generates recipes
  - plays **Chef Run** while waiting and handles the "recipes are ready" button
  - checks the "uses N of yours" coverage
  - opens a recipe, scales it and asks for swaps
  - saves and favourites it
  - runs Cook Mode to the end
  - checks the cookbook and account stats (including the best game score)
  - signs out and confirms the app is gated again

  It fails on any browser console error. Set `SHOWCASE=1` for viewport-sized screenshots.
- `a11y.js` runs axe-core (WCAG 2.1 A/AA + best practice) on 10 screens in light and dark mode, including the game, and fails on any violation.

```bash
# terminal 1, from the repo root
DATABASE_URL=sqlite:///./e2e.sqlite3 python scripts/run_mock_server.py

# terminal 2
cd e2e && npm install && npx playwright install chromium
mkdir -p screenshots && npm test
```
