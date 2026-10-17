// Browser end-to-end journey. Run against the demo server: see e2e/README.md
const { chromium } = require('playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8000';
const shotDir = process.env.SHOT_DIR || 'e2e/screenshots';
const log = (...a) => console.log('✓', ...a);

(async () => {
  const mobile = (process.argv[2] || '').startsWith('mobile');
  const scheme = process.argv[3] || (mobile ? 'light' : 'dark');
  const tag = `${mobile ? 'mobile' : 'desktop'}-${scheme}`;
  const full = !process.env.SHOWCASE;
  const shot = (p, n, f = full) => p.screenshot({ path: `${shotDir}/j-${tag}-${n}.png`, fullPage: f });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 }, colorScheme: scheme });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));

  // gated: any page sends you to the welcome screen first
  await p.goto(base + '/cookbook');
  await p.waitForURL(/\/welcome/);
  await p.waitForSelector('.auth-card');
  await p.waitForTimeout(900);
  log('gated →', new URL(p.url()).pathname + new URL(p.url()).search);
  await shot(p, 'welcome', false);

  // sign up
  await p.fill('#name', 'Deepika');
  await p.fill('#email', `cook${Date.now()}@example.com`);
  await p.fill('#password', 'masala-dosa-2026!');
  await p.click('form button[type=submit]');
  await p.waitForURL(base + '/cookbook');
  log('signed up and returned to', new URL(p.url()).pathname);

  // cook screen
  await p.click('a[href="/"] >> visible=true');
  await p.waitForSelector('#ingredients');
  await p.fill('#ingredients', 'rice, lemon'); await p.keyboard.press('Enter');
  await p.click('.sticker:has-text("curry")').catch(() => {});
  await p.fill('#ingredients', 'curry leaves'); await p.keyboard.press('Enter');
  await p.click('.mood:has-text("Tiffin box")');
  await p.click('.filters summary');
  await p.check('.toggle input[value="vegetarian"]', { force: true });
  log('chips', await p.locator('#ingredients').evaluate(() => document.querySelectorAll('.chip').length), 'filters badge', await p.textContent('.filters .badge'));
  await shot(p, 'cook');

  // results: play Chef Run while the AI thinks
  await p.click('button:has-text("Cook something!")');
  await p.waitForSelector('.game canvas');
  await p.waitForTimeout(400);
  await shot(p, 'game-idle', false);
  await p.locator('.game canvas').click();
  for (let i = 0; i < 8; i++) { await p.waitForTimeout(260); await p.keyboard.press('Space'); }
  await shot(p, 'game-running', false);
  // either the ready button shows (still running) or the cards reveal after a crash
  await p.waitForSelector('.game__ready:not([hidden]) button, .rcard', { timeout: 15000 });
  if (await p.locator('.game__ready:not([hidden]) button').count()) {
    await shot(p, 'game-ready', false);
    log('recipes ready while playing → button shown');
    await p.click('.game__ready button', { timeout: 2500 }).catch(() => log('runner crashed first → recipes revealed automatically'));
  }
  await p.waitForSelector('.rcard');
  await p.waitForTimeout(1200);
  log('results', await p.locator('.rcard__title').allTextContents(), '| coverage:', (await p.locator('.coverage').first().textContent()).trim());
  await shot(p, 'results', false);

  // recipe page
  await p.click('.rcard__title a >> nth=0');
  await p.waitForSelector('.rhero h1');
  await p.waitForTimeout(1200);
  log('recipe', await p.textContent('.rhero h1'), '| yours tags', await p.locator('.ing__tag--yours').count(), '| to-buy tags', await p.locator('.ing__tag--need').count());
  const q0 = (await p.locator('.ing__qty').first().textContent()).trim();
  await p.click('[aria-label="More servings"]'); await p.click('[aria-label="More servings"]');
  log('scaled', q0, '→', (await p.locator('.ing__qty').first().textContent()).trim());
  await p.click('.ing >> nth=1 >> text=Swap it');
  await p.waitForSelector('.subs li');
  log('swaps', await p.locator('.subs li').count());
  await shot(p, 'recipe');

  // save + favourite
  await p.click('.actionbar .heart');
  await p.waitForURL(/\/cookbook\/\d+/);
  await p.click('.actionbar .heart');
  await p.waitForSelector('.actionbar .heart.is-on');
  log('saved + favourited', new URL(p.url()).pathname);

  // cook mode
  await p.click('button:has-text("Start cooking")');
  await p.waitForSelector('.cookmode');
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(700);
  log('cook mode', await p.textContent('.cstep__num'));
  await shot(p, 'cookmode', false);
  for (let i = 0; i < 12 && !(await p.locator('.cookmode__done').count()); i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(200); }
  await p.waitForSelector('.cookmode__done');
  await p.waitForTimeout(900);
  await shot(p, 'cookmode-done', false);
  await p.click('.cookmode__done button');

  // cookbook
  await p.click('a[href="/cookbook"] >> visible=true');
  await p.waitForSelector('.rcard');
  await p.waitForTimeout(700);
  log('cookbook', await p.locator('.rcard__title').allTextContents());
  await shot(p, 'cookbook', false);

  // account
  await p.click('a[href="/account"] >> visible=true');
  await p.waitForSelector('.statgrid');
  await p.waitForTimeout(1100);
  log('stats', (await p.locator('.bigstat').allTextContents()).join(' | '));
  await shot(p, 'account', false);

  // sign out → back to welcome, app pages gated again
  await p.click('button:has-text("Sign out")');
  await p.waitForURL(/\/welcome/);
  await p.goto(base + '/');
  await p.waitForURL(/\/welcome/);
  log('signed out; home is gated again');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO CONSOLE ERRORS');
  if (errors.length) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
