// Browser end-to-end check. Run against the mock server: see e2e/README.md
const { chromium } = require('playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8000';
const shot = (p, n, full = false) => p.screenshot({ path: `${process.env.SHOT_DIR || 'e2e/screenshots'}/j-${n}.png`, fullPage: process.env.SHOWCASE ? false : full });
const log = (...a) => console.log('✓', ...a);
(async () => {
  const vp = (process.argv[2] || '').startsWith('mobile') ? { width: 390, height: 844 } : { width: 1360, height: 900 };
  const tag = (process.argv[2] || 'desktop') + (process.argv[3] ? '-' + process.argv[3] : '');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: vp, colorScheme: process.argv[3] || (tag === 'mobile' ? 'light' : 'dark') });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror ' + e.message));
  const email = `cook${Date.now()}@example.com`;

  // signup
  await p.goto(base + '/signup');
  await p.fill('#name', 'Deepika'); await p.fill('#email', email); await p.fill('#password', 'masala-dosa-2026!');
  await p.click('button[type=submit]');
  await p.waitForURL(base + '/'); await p.waitForSelector('.search');
  log('signed up', await p.getAttribute('a[aria-label="Your account"]', 'title'));

  // pantry: add items with expiry
  await p.click('a[href="/pantry"] >> visible=true');
  await p.waitForSelector('#p-what');
  await p.fill('#p-what', '250 g spinach, 200 g paneer');
  await p.click('text=+2 days');
  await p.click('button:has-text("Add to pantry")');
  await p.waitForSelector('.jar');
  await p.fill('#p-what', '1 kg rice, 6 eggs, onion, tomato');
  await p.click('text=+2 weeks');
  await p.click('button:has-text("Add to pantry")');
  await p.waitForFunction(() => document.querySelectorAll('.jar').length >= 6);
  await p.waitForTimeout(900);
  log('pantry jars', await p.locator('.jar').count(), 'rescue banner:', await p.locator('.rescue-banner').count());
  await shot(p, `${tag}-pantry`, true);

  // rescue → results
  await p.click('.rescue-banner button');
  await p.waitForURL(base + '/results');
  await p.waitForSelector('.cooking', { timeout: 5000 }).catch(() => {});
  await p.waitForSelector('.rcard', { timeout: 15000 });
  await p.waitForTimeout(800);
  log('rescue results', await p.locator('.rcard__title').allTextContents(), 'ribbons', await p.locator('.rcard__ribbon').allTextContents());
  await shot(p, `${tag}-rescue-results`);

  // discover search with chips + mood + filter
  await p.click('a.brand');
  await p.waitForSelector('#ingredients');
  await p.fill('#ingredients', 'rice, curry leaves'); await p.keyboard.press('Enter');
  await p.click('.quickpicks button:has-text("lemon")').catch(() => {});
  await p.click('.mood:has-text("Tiffin box")');
  await p.click('.filters summary');
  await p.check('.toggle input[value="vegetarian"]', { force: true });
  log('chips', await p.locator('#ingredients').evaluate(() => document.querySelectorAll('.chip').length));
  await shot(p, `${tag}-search`, true);
  await p.click('button:has-text("Find recipes")');
  await p.waitForSelector('.rcard', { timeout: 15000 });
  await p.waitForTimeout(900);
  log('results', await p.locator('.rcard__title').allTextContents(), 'match:', await p.locator('.match').first().textContent());
  await shot(p, `${tag}-results`);

  // detail (view transition)
  await p.click('.rcard__title a >> nth=0');
  await p.waitForSelector('.rhero h1');
  await p.waitForTimeout(1200);
  log('detail', await p.textContent('.rhero h1'), 'have badges', await p.locator('.ing__have--yes').count(), 'timer chips', await p.locator('.steps .timer-chip').count());
  const q0 = await p.locator('.ing__qty').first().textContent();
  await p.click('[aria-label="More servings"]'); await p.click('[aria-label="More servings"]');
  log('scaled', q0, '→', await p.locator('.ing__qty').first().textContent());
  await shot(p, `${tag}-detail`, true);

  // save + favourite
  await p.click('.actionbar .heart');
  await p.waitForURL(/\/cookbook\/\d+/);
  await p.click('.actionbar .heart');
  await p.waitForSelector('.actionbar .heart.is-on');
  log('saved+fav', p.url());

  // missing → shopping
  const missingBtn = p.locator('button:has-text("missing to shopping list")');
  if (await missingBtn.count()) { await missingBtn.click(); await p.waitForTimeout(500); log('added missing to list'); }

  // substitutes
  await p.click('.ing >> nth=1 >> text=Swap it');
  await p.waitForSelector('.subs li');
  log('subs', (await p.locator('.subs li').allTextContents()).length);

  // timer
  await p.click('.steps .timer-chip >> nth=0').catch(() => {});
  await p.waitForSelector('.timer', { timeout: 3000 }).catch(() => {});
  log('timer dock', await p.locator('.timer').count());

  // cook mode
  await p.click('button:has-text("Cook mode")');
  await p.waitForSelector('.cookmode');
  await shot(p, `${tag}-cookmode-prep`);
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(600);
  await shot(p, `${tag}-cookmode-step`);
  const steps = await p.evaluate(() => document.querySelector('.cstep__num')?.textContent);
  log('cook step', steps);
  for (let i = 0; i < 10; i++) { if (await p.locator('.cookmode__done').count()) break; await p.keyboard.press('ArrowRight'); await p.waitForTimeout(250); }
  await p.waitForSelector('.cookmode__done');
  await p.waitForTimeout(1200);
  log('cook done; used-up panel:', await p.locator('.cookmode__done .panel').count());
  await shot(p, `${tag}-cookmode-done`);
  if (await p.locator('.cookmode__done button:has-text("Update pantry")').count()) {
    await p.check('.cookmode__done .panel input[type=checkbox] >> nth=0');
    await p.click('.cookmode__done button:has-text("Update pantry")');
    await p.waitForSelector('.cookmode__done .callout');
    log('consume:', await p.textContent('.cookmode__done .callout'));
  }
  await p.click('.cookmode__done button:has-text("Close")');

  // share
  await p.click('.actionbar button:has-text("Share")');
  await p.waitForSelector('dialog.modal input');
  const shareUrl = await p.inputValue('dialog.modal input');
  log('share url', shareUrl);
  await p.keyboard.press('Escape');

  // cookbook
  await p.click('a[href="/cookbook"] >> visible=true');
  await p.waitForSelector('.rcard');
  log('cookbook', await p.locator('.rcard__title').allTextContents());
  await shot(p, `${tag}-cookbook`);

  // planner: add from cookbook, then build shopping list
  await p.click('a[href="/plan"] >> visible=true');
  await p.waitForSelector('.slot');
  await p.click('.day--today .slot >> nth=2');
  await p.waitForSelector('dialog.modal .picker button');
  await p.click('dialog.modal .picker button >> nth=0');
  await p.waitForSelector('.slot--filled');
  await p.waitForTimeout(700);
  await shot(p, `${tag}-planner`, tag === 'mobile');
  await p.click('button:has-text("Build shopping list")');
  await p.waitForTimeout(800);
  log('planned', await p.locator('.slot--filled').count());

  // shopping
  await p.click('a[href="/shopping"] >> visible=true');
  await p.waitForSelector('.item');
  const n = await p.locator('.item').count();
  await p.click('.item input >> nth=0'); await p.click('.item input >> nth=1');
  await p.waitForTimeout(500);
  log('shopping items', n, await p.textContent('.basket'));
  await shot(p, `${tag}-shopping`, true);
  await p.click('button:has-text("Move bought items to pantry")');
  await p.waitForTimeout(600);
  log('after move', await p.locator('.item').count());

  // account
  await p.click('a[aria-label="Your account"]');
  await p.waitForSelector('.statgrid');
  await p.waitForTimeout(1000);
  log('stats', (await p.locator('.bigstat').allTextContents()).join(' | '));
  await shot(p, `${tag}-account`);

  // public share view in a fresh context
  const anon = await (await b.newContext({ viewport: vp })).newPage();
  await anon.goto(shareUrl);
  await anon.waitForSelector('.rhero h1');
  log('public share ok:', await anon.textContent('.rhero h1'), 'save button:', await anon.locator('button:has-text("Save to my cookbook")').count());
  await anon.close();

  // sign out
  await p.click('button:has-text("Sign out")');
  await p.waitForURL(base + '/');
  log('signed out; sign in visible:', await p.locator('a[href="/login"]').count());

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO CONSOLE ERRORS');
  if (errors.length) process.exitCode = 1;
  await b.close();
})().catch(e => { console.error('FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
