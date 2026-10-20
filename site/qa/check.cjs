'use strict';

// Reuses the project's installed Playwright and the existing Microsoft Edge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { gzipSync } = require('node:zlib');
const { chromium } = require('playwright');
const { createServer } = require('../preview.cjs');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'qa/evidence');
fs.mkdirSync(evidence, { recursive: true });

function footprint() {
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
  const files = walk(root);
  const live = files.filter(file => /\.(?:html|css|js|svg|webp|txt)$/.test(file) && !file.includes(`${path.sep}qa${path.sep}`));
  return {
    components: ['gsap.min.js', 'ScrollTrigger.min.js'].map(name => { const data = fs.readFileSync(path.join(root, 'vendor', name)); return { name, version: '3.15.0', bytes: data.length, gzipBytes: gzipSync(data).length }; }),
    productionBytes: live.reduce((total, file) => total + fs.statSync(file).size, 0),
    productionGzipBytes: live.reduce((total, file) => total + gzipSync(fs.readFileSync(file)).length, 0),
    directoryBytes: files.reduce((total, file) => total + fs.statSync(file).size, 0),
  };
}

async function auditContrast(page) {
  return page.evaluate(() => {
    const parse = value => value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
    const blend = (a, b) => a.slice(0, 3).map((v, i) => v * (a[3] ?? 1) + b[i] * (1 - (a[3] ?? 1)));
    const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const failures = [];
    let minimumBody = Infinity;
    for (const element of document.querySelectorAll('p, h1, h2, h3, a, button, span, small, strong')) {
      if (!element.textContent.trim() || ![...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) continue;
      if (element.closest('[aria-hidden="true"]') || !element.getClientRects().length) continue;
      const style = getComputedStyle(element);
      if (Number(style.opacity) < .99 || style.visibility === 'hidden') continue;
      let bg = [242, 243, 237];
      const ancestors = []; let ancestor = element;
      while (ancestor) { ancestors.unshift(ancestor); ancestor = ancestor.parentElement; }
      ancestors.forEach(item => {
        bg = blend(parse(getComputedStyle(item).backgroundColor), bg);
        // Conservative brightest gradient envelopes, including animated ambient light.
        if (item.classList.contains('hero')) bg = [61, 83, 87];
        if (item.classList.contains('site-header')) bg = item.classList.contains('is-scrolled') ? [33, 55, 61] : [61, 83, 87];
        if (item.classList.contains('campus-panel')) bg = [216, 228, 217];
      });
      const fg = blend(parse(style.color), bg);
      const values = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
      const ratio = (values[1] + .05) / (values[0] + .05);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      const threshold = large ? 3 : 4.5;
      if (!large) minimumBody = Math.min(minimumBody, ratio);
      if (ratio < threshold) failures.push({ text: element.textContent.trim().slice(0, 45), color: style.color, background: bg.map(Math.round), ratio: +ratio.toFixed(2), threshold });
    }
    return { minimumBody: +minimumBody.toFixed(2), failures };
  });
}

(async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const report = { timestamp: new Date().toISOString(), results: [], errors: [], runtime: {}, contrast: null, footprint: null };
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    report.browser = browser.version();
    const viewports = [[1440, 900], [1280, 800], [768, 1024], [390, 844], [360, 800]];
    for (const [width, height] of viewports) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: width <= 768, hasTouch: width <= 768 });
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
      page.on('response', response => { if (response.status() >= 400) report.errors.push(`HTTP ${response.status()} ${response.url()}`); });
      await page.goto(origin, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2300);
      if (width === 1440) report.firstLoad = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0];
        const resources = performance.getEntriesByType('resource');
        return {
          htmlBytes: navigation.decodedBodySize,
          resourceBytes: resources.reduce((total, resource) => total + resource.decodedBodySize, 0),
          transferBytesWithHeaders: navigation.transferSize + resources.reduce((total, resource) => total + resource.transferSize, 0),
          resources: resources.map(resource => new URL(resource.name).pathname),
          externalRequests: resources.filter(resource => new URL(resource.name).origin !== location.origin).length,
        };
      });
      assert.equal(await page.locator('.feature-card').count(), 6);
      assert.equal(await page.locator('.download-grid a').count(), 3);
      for (const id of ['hero', 'quickstart', 'features', 'appearance', 'download']) {
        await page.locator(`#${id}`).scrollIntoViewIfNeeded();
        await page.waitForTimeout(1000);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert.ok(overflow <= 1, `${width}x${height} ${id} horizontal overflow: ${overflow}`);
        assert.ok(await page.locator(`#${id} h1, #${id} h2`).isVisible());
      }
      const classic = page.locator('[data-appearance="classic"]');
      await classic.click();
      await page.waitForTimeout(650);
      assert.equal(await classic.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-image="classic"]').evaluate(image => Number(getComputedStyle(image).opacity)), 1);
      await page.locator('[data-appearance="liquid"]').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('[data-appearance="liquid"]').getAttribute('aria-pressed'), 'true');
      const focus = await page.locator('[data-appearance="liquid"]').evaluate(button => ({ visible: button.matches(':focus-visible'), outline: getComputedStyle(button).outlineWidth }));
      assert.ok(focus.visible && parseFloat(focus.outline) >= 3);
      const images = await page.locator('img').evaluateAll(list => list.every(image => image.complete && image.naturalWidth > 0 && image.hasAttribute('alt')));
      assert.ok(images, 'All images must load and have alt attributes');
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(evidence, `${width}x${height}.png`) });
      if (width === 1440) {
        report.contrast = await auditContrast(page);
        await page.screenshot({ path: path.join(evidence, 'desktop-full.png'), fullPage: true });
        report.network = await page.evaluate(() => performance.getEntriesByType('resource').map(resource => ({ name: new URL(resource.name).pathname, bytes: resource.decodedBodySize, transferBytes: resource.transferSize })));
      }
      if (width === 390) await page.screenshot({ path: path.join(evidence, 'mobile-full.png'), fullPage: true });
      report.results.push(`${width}x${height}: layout, images, keyboard focus, appearance switch passed`);
      await context.close();
    }

    const reducedContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const reducedPage = await reducedContext.newPage();
    await reducedPage.goto(origin, { waitUntil: 'networkidle' });
    assert.equal(await reducedPage.evaluate(() => ScrollTrigger.getAll().length), 0);
    assert.equal(await reducedPage.locator('[data-reveal]').evaluateAll(elements => elements.every(element => Number(getComputedStyle(element).opacity) === 1)), true);
    await reducedPage.locator('[data-appearance="classic"]').click();
    assert.equal(await reducedPage.locator('[data-image="classic"]').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
    report.results.push('prefers-reduced-motion: static content, no scroll triggers, instant appearance switch passed');
    await reducedContext.close();

    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ javaScriptEnabled, viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const fileErrors = [];
      page.on('pageerror', error => fileErrors.push(error.message));
      await page.goto(pathToFileURL(path.join(root, 'index.html')).href, { waitUntil: 'load' });
      assert.ok(await page.locator('h1').isVisible());
      assert.equal(await page.locator('.download-grid a').count(), 3);
      assert.ok(await page.locator('.hero-window img').evaluate(image => image.complete && image.naturalWidth > 0));
      if (javaScriptEnabled) {
        await page.locator('[data-appearance="classic"]').click();
        assert.equal(await page.locator('[data-appearance="classic"]').getAttribute('aria-pressed'), 'true');
      } else assert.ok(await page.locator('noscript a').isVisible());
      assert.deepEqual(fileErrors, []);
      report.results.push(`file:// with JavaScript ${javaScriptEnabled ? 'enabled' : 'disabled'}: content, image and download links passed`);
      await context.close();
    }

    const fallbackContext = await browser.newContext();
    await fallbackContext.route('**/vendor/*.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    const fallbackPage = await fallbackContext.newPage();
    await fallbackPage.goto(origin, { waitUntil: 'networkidle' });
    assert.ok(await fallbackPage.locator('h1').isVisible());
    assert.ok(await fallbackPage.locator('[data-reveal]').evaluateAll(elements => elements.every(element => Number(getComputedStyle(element).opacity) === 1)));
    await fallbackPage.locator('[data-appearance="classic"]').click();
    assert.equal(await fallbackPage.locator('[data-appearance="classic"]').getAttribute('aria-pressed'), 'true');
    report.results.push('Animation library unavailable: static content and native appearance controls passed');
    await fallbackContext.close();

    const perfContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await perfContext.newPage();
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const cdp = await perfContext.newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
    const sample = async (name, activity) => {
      const before = await metrics(); const start = performance.now();
      await activity();
      const elapsed = (performance.now() - start) / 1000;
      const after = await metrics();
      report.runtime[name] = { seconds: +elapsed.toFixed(2), rendererMainThreadPercent: +((after.TaskDuration - before.TaskDuration) / elapsed * 100).toFixed(2), jsHeapMiB: +(after.JSHeapUsedSize / 1024 ** 2).toFixed(2) };
    };
    await sample('idle', () => page.waitForTimeout(3000));
    await sample('scroll', async () => { for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, i < 15 ? 280 : -280); await page.waitForTimeout(100); } });
    await page.locator('#features').scrollIntoViewIfNeeded(); await page.waitForTimeout(900);
    await sample('pointer', async () => {
      const rect = await page.locator('.feature-card').first().boundingBox();
      for (let i = 0; i < 30; i++) { await page.mouse.move(rect.x + 20 + i * 5, rect.y + 80 + Math.sin(i / 3) * 30); await page.waitForTimeout(100); }
    });
    await perfContext.close();
    assert.deepEqual(report.errors, []);
    report.footprint = footprint();
    fs.writeFileSync(path.join(root, 'qa/results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    assert.deepEqual(report.contrast.failures, [], 'Contrast audit must pass');
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
