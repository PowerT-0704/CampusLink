'use strict';

// Capture the current v1.4.2 renderer with an in-memory, offline desktop bridge.
// No Electron process, settings files, credentials, or campus requests are used.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { builtinProfiles, publicProfile, defaultProfile } = require('../../electron/profiles.cjs');
const root = path.resolve(__dirname, '../..');

(async () => {
  const { build } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campuslink-site-capture-'));
  // Vite cannot resolve a source root containing '#'. Stage only public UI sources.
  const stage = path.join(cacheDir, 'renderer');
  fs.mkdirSync(stage);
  fs.cpSync(path.join(root, 'src'), path.join(stage, 'src'), { recursive: true });
  fs.mkdirSync(path.join(stage, 'assets'));
  fs.copyFileSync(path.join(root, 'assets/icon.svg'), path.join(stage, 'assets/icon.svg'));
  const modulesLink = path.join(stage, 'node_modules');
  fs.symlinkSync(path.join(root, 'node_modules'), modulesLink, 'junction');
  const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]+>/i, '');
  fs.writeFileSync(path.join(stage, 'index.html'), source);
  const output = path.join(cacheDir, 'output');
  await build({ root: stage, configFile: false, base: './', plugins: [react()], resolve: { preserveSymlinks: true }, cacheDir: path.join(cacheDir, 'cache'), logLevel: 'warn', build: { outDir: output, emptyOutDir: false } });
  const server = require('../preview.cjs').createServer(output);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1360, height: 880 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const snapshot = {
      settings: { profileId: defaultProfile.id, username: '', rememberPassword: false, autoLaunch: false, autoConnect: false, autoReconnect: true, reconnectIntervalSeconds: 10, minimizeToTray: true, appearance: 'liquid', parameters: {} },
      hasPassword: false, credentialStatus: { storage: 'none', available: false, needsRetry: false, message: '' }, profiles: builtinProfiles.map(publicProfile),
      connection: { status: 'idle', message: '先连接校园 Wi-Fi 或网线，再进行认证。', monitoring: false, reconnectPaused: false },
      logs: [], app: { version: '1.4.2', platform: 'browser', packaged: false, windowGlass: false, firstRun: false, secureStorage: false },
    };
    await context.addInitScript(value => {
      let state = value;
      const listeners = new Set();
      const emit = () => { listeners.forEach(listener => listener(structuredClone(state))); return structuredClone(state); };
      const offline = async () => { throw new Error('离线展示不执行认证或文件操作'); };
      window.campus = {
        getSnapshot: async () => structuredClone(state),
        onSnapshot: fn => { listeners.add(fn); return () => listeners.delete(fn); },
        setAppearance: async appearance => { state.settings.appearance = appearance; return emit(); },
        getUpdateState: async () => ({ status: 'idle', currentVersion: '1.4.2' }), onUpdate: () => () => {},
        saveSettings: offline, saveCredentials: offline, completeOnboarding: offline, retryCredentials: offline, connect: offline, disconnect: offline, checkStatus: offline,
        importProfile: offline, removeProfile: offline, exportExample: offline, exportDiagnostics: offline, exportProfile: offline,
        checkForUpdates: offline, openRelease: offline, openPortal: offline, openUrl: offline, clearCredentials: offline,
        windowAction: offline, copyText: offline,
      };
    }, snapshot);
    const page = await context.newPage();
    page.on('pageerror', error => console.error('Renderer:', error.message));
    page.on('console', message => { if (message.type() === 'error') console.error('Console:', message.text()); });
    page.on('response', response => { if (response.status() >= 400) console.error('HTTP:', response.status(), response.url()); });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '连接方案', exact: false }).first().click();
    await page.getByRole('heading', { name: '成都理工大学（宜宾校区）· 锐捷 ePortal' }).waitFor();
    // A neutral wallpaper behind transparent material, only in this capture context.
    await page.addStyleTag({ content: ':root[data-appearance="liquid"] body { background: radial-gradient(ellipse at 0 15%, #c5d8cf, transparent 55%), linear-gradient(125deg, #e0e9e1, #becfc7); }' });
    await page.waitForTimeout(700);
    for (const appearance of ['liquid', 'classic']) {
      await page.evaluate(async value => window.campus.setAppearance(value), appearance);
      await page.waitForTimeout(650);
      if (!await page.getByText('v1.4.2', { exact: true }).first().isVisible()) throw new Error('Expected v1.4.2 in screenshot');
      const png = await page.screenshot();
      const webp = await page.evaluate(async data => {
        const image = new Image(); image.src = data; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        canvas.getContext('2d').drawImage(image, 0, 0); return canvas.toDataURL('image/webp', .9).split(',')[1];
      }, `data:image/png;base64,${png.toString('base64')}`);
      const file = path.join(root, `site/assets/campuslink-${appearance}.webp`);
      fs.writeFileSync(file, Buffer.from(webp, 'base64'));
      console.log(`${path.basename(file)}: ${fs.statSync(file).size} bytes`);
    }
    console.log('Current source renderer captured offline; no campus authentication performed.');
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (fs.existsSync(modulesLink)) fs.unlinkSync(modulesLink);
    // Only remove the verified, task-created cache directory.
    if (path.resolve(cacheDir).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(cacheDir).startsWith('campuslink-site-capture-')) fs.rmSync(cacheDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
