// Browser end-to-end check. Run against the mock server: see e2e/README.md
const { chromium } = require('playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8000';
(async () => {
  const b = await chromium.launch();
  const all = {};
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, bypassCSP: true, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    const scan = async (label) => {
      await p.waitForTimeout(700);
      await p.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const r = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] })).violations
        .map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0, 2).map(x => x.target.join(' ') + ' :: ' + (x.failureSummary || '').split('\n')[1]) })));
      all[`${scheme}:${label}`] = r;
    };
    await p.goto(base + '/'); await p.waitForSelector('.search'); await scan('home-anon');
    await p.goto(base + '/signup'); await p.waitForSelector('#email'); await scan('signup');
    await p.fill('#email', `a11y-${scheme}-${Date.now()}@example.com`); await p.fill('#password', 'masala-dosa-2026!'); await p.click('button[type=submit]');
    await p.waitForURL(base + '/');
    await p.goto(base + '/pantry'); await p.waitForSelector('#p-what');
    await p.fill('#p-what', 'spinach, 2 kg rice'); await p.click('text=+2 days'); await p.click('button:has-text("Add to pantry")'); await p.waitForSelector('.jar'); await scan('pantry');
    await p.goto(base + '/'); await p.waitForSelector('.search'); await p.fill('#ingredients', 'rice'); await p.keyboard.press('Enter'); await p.click('.filters summary'); await scan('home-signed-in');
    await p.click('button:has-text("Find recipes")'); await p.waitForSelector('.rcard'); await scan('results');
    await p.click('.rcard__title a >> nth=0'); await p.waitForSelector('.rhero h1'); await scan('recipe');
    await p.click('.actionbar .heart'); await p.waitForURL(/cookbook\/\d+/);
    await p.click('button:has-text("Cook mode")'); await p.waitForSelector('.cookmode'); await p.keyboard.press('ArrowRight'); await scan('cookmode'); await p.keyboard.press('Escape');
    await p.goto(base + '/cookbook'); await p.waitForSelector('.rcard'); await scan('cookbook');
    await p.goto(base + '/plan'); await p.waitForSelector('.slot'); await scan('plan');
    await p.goto(base + '/shopping'); await p.waitForSelector('.basket'); await scan('shopping');
    await p.goto(base + '/account'); await p.waitForSelector('.statgrid'); await scan('account');
    await ctx.close();
  }
  let total = 0;
  for (const [k, v] of Object.entries(all)) { if (v.length) { console.log(k, JSON.stringify(v, null, 1)); total += v.length; } }
  console.log('pages scanned:', Object.keys(all).length, 'violation types:', total);
  if (total) process.exitCode = 1;
  await b.close();
})().catch(e => { console.error('FAILED', e.message.split('\n').slice(0, 5).join('\n')); process.exit(1); });
