'use strict';

// Native OS encryption, real Electron restarts, isolated data and loopback-only
// authentication. No user settings, school accounts or real campus requests.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { defaults } = require('../electron/service.cjs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'campuslink-native-credentials-'));
  const evidence = path.join(root, 'artifacts', 'credential-acceptance');
  fs.mkdirSync(evidence, { recursive: true });
  fs.rmSync(path.join(evidence, 'results.json'), { force: true });
  const apps = new Set();
  const errors = [];
  const logins = [];
  let online = false;
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/login') { logins.push(new URLSearchParams(body).get('password')); online = true; response.end('{"success":true}'); }
    else if (request.url === '/api/logout') { online = false; response.end('{"success":true}'); }
    else if (request.url === '/api/status') response.end(JSON.stringify({ online }));
    else { response.statusCode = 404; response.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = structuredClone(require('../examples/custom-campus.example.json'));
  profile.id = 'native-encryption-fixture'; profile.name = '本机加密验收（模拟校园网）'; profile.homepage = `${origin}/`;
  for (const operation of Object.values(profile.operations)) operation.url = `${origin}${new URL(operation.url).pathname}`;
  function seed(directory) {
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ version: 1, settings: { ...defaults(), profileId: profile.id, parameters: { operator: 'campus' } }, profiles: [profile], credential: null, onboardingComplete: false }));
  }
  async function launch(directory, legacyDirectory) {
    const env = { ...process.env, CAMPUS_LINK_DATA_DIR: directory };
    delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
    delete env.CAMPUS_LINK_LEGACY_DATA_DIR;
    if (legacyDirectory) env.CAMPUS_LINK_LEGACY_DATA_DIR = legacyDirectory;
    const app = await electron.launch({ args: [root], cwd: root, env });
    apps.add(app);
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await expect.poll(() => page.evaluate(() => Boolean(window.campus))).toBe(true);
    return { app, page };
  }
  async function close(app) { await app.close(); apps.delete(app); }
  async function expectFocusInside(page, dialog) {
    for (const key of ['Tab', 'Shift+Tab']) for (let i = 0; i < 12; i++) {
      await page.keyboard.press(key);
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
    }
  }
  try {
    const rememberedDirectory = path.join(temporary, 'remembered');
    seed(rememberedDirectory);
    let current = await launch(rememberedDirectory);
    const welcome = current.page.getByRole('dialog', { name: '欢迎使用 · 岚连', exact: true });
    await expect(welcome).toBeVisible();
    assert.equal(await current.app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()), true, 'Native secure storage must be available for this acceptance test');
    await expect(welcome.getByRole('checkbox', { name: /记住密码/ })).not.toBeChecked();
    await expectFocusInside(current.page, welcome);
    await welcome.getByLabel('校园网账号', { exact: true }).fill('native-fixture-account');
    await welcome.getByLabel('登录密码', { exact: true }).fill('native-fixture-密码&+123');
    await welcome.getByRole('checkbox', { name: /记住密码/ }).check();
    await welcome.getByLabel('断连检测间隔（秒）', { exact: true }).fill('5');
    await current.page.screenshot({ path: path.join(evidence, 'onboarding-encrypted.png') });
    await welcome.getByRole('button', { name: '保存并开始', exact: true }).click();
    await expect(welcome).not.toBeVisible();
    await current.page.getByRole('button', { name: '应用设置', exact: true }).click();
    await current.page.getByRole('switch', { name: '启动后自动连接', exact: true }).click();
    await expect(current.page.getByRole('switch', { name: '启动后自动连接', exact: true })).toBeChecked();
    await current.page.getByRole('heading', { name: '账号与隐私', exact: true }).scrollIntoViewIfNeeded();
    await expect(current.page.getByText('系统加密', { exact: true })).toBeVisible();
    await current.page.screenshot({ path: path.join(evidence, 'encrypted-settings.png') });
    const persisted = JSON.parse(fs.readFileSync(path.join(rememberedDirectory, 'settings.json')));
    assert.equal(persisted.credential.password, undefined);
    const ciphertext = persisted.credential.encrypted;
    assert.ok(ciphertext);
    assert.equal(JSON.stringify(persisted).includes('native-fixture-密码&+123'), false);
    await close(current.app);
    for (let restart = 0; restart < 3; restart++) {
      online = false;
      const previousLogins = logins.length;
      current = await launch(rememberedDirectory);
      await expect.poll(() => current.page.evaluate(async () => (await window.campus.getSnapshot()).connection.status)).toBe('connected');
      assert.equal(logins.length, previousLogins + 1);
      assert.equal(logins.at(-1), 'native-fixture-密码&+123');
      await expect(current.page.getByRole('dialog', { name: '欢迎使用 · 岚连' })).toHaveCount(0);
      const snapshot = await current.page.evaluate(() => window.campus.getSnapshot());
      assert.equal(snapshot.credentialStatus.available, true);
      assert.equal(JSON.stringify(snapshot).includes(ciphertext), false);
      assert.equal(JSON.parse(fs.readFileSync(path.join(rememberedDirectory, 'settings.json'))).credential.encrypted, ciphertext);
      if (restart === 0) {
        const count = logins.length;
        online = false;
        await expect.poll(() => logins.length, { timeout: 15000 }).toBe(count + 1);
        assert.equal(logins.at(-1), 'native-fixture-密码&+123');
        await current.page.screenshot({ path: path.join(evidence, 'restart-auto-connected.png') });
      }
      await close(current.app);
    }
    console.log('Native encryption: three full Electron restarts and outage reconnection passed without entering the password again.');

    for (const kind of ['plaintext', 'encrypted']) {
      const legacyDirectory = path.join(temporary, `legacy-${kind}`);
      const legacySource = path.join(temporary, `legacy-source-${kind}`);
      seed(legacySource);
      const legacyFile = path.join(legacySource, 'settings.json');
      const legacy = JSON.parse(fs.readFileSync(legacyFile));
      legacy.settings.username = 'native-fixture-account';
      legacy.settings.rememberPassword = true; legacy.settings.autoConnect = true;
      legacy.credential = { profileId: profile.id, username: legacy.settings.username, ...(kind === 'plaintext' ? { password: 'native-fixture-密码&+123' } : { encrypted: ciphertext }) };
      delete legacy.onboardingComplete;
      fs.writeFileSync(legacyFile, JSON.stringify(legacy));
      if (kind === 'encrypted' && process.platform === 'win32') fs.copyFileSync(path.join(rememberedDirectory, 'Local State'), path.join(legacySource, 'Local State'));
      online = false;
      const previousLogins = logins.length;
      current = await launch(legacyDirectory, legacySource);
      try {
        await expect.poll(() => current.page.evaluate(async () => (await window.campus.getSnapshot()).connection.status)).toBe('connected');
      } catch (error) {
        const snapshot = await current.page.evaluate(() => window.campus.getSnapshot());
        console.error('Legacy migration diagnostic:', { kind, autoConnect: snapshot.settings.autoConnect, credentials: snapshot.credentialStatus, messages: snapshot.logs.map(entry => entry.message) });
        throw error;
      }
      assert.equal(logins.length, previousLogins + 1);
      assert.equal(logins.at(-1), 'native-fixture-密码&+123');
      await expect(current.page.getByRole('dialog', { name: '欢迎使用 · 岚连' })).toHaveCount(0);
      const migrated = JSON.parse(fs.readFileSync(path.join(legacyDirectory, 'settings.json')));
      assert.equal(migrated.credential.password, undefined);
      assert.ok(migrated.credential.encrypted);
      if (kind === 'encrypted') assert.equal(migrated.credential.encrypted, ciphertext);
      await close(current.app);
    }
    console.log('Native upgrade compatibility: legacy plaintext migration and existing ciphertext both restored automatic login without input.');

    const skippedDirectory = path.join(temporary, 'skipped');
    seed(skippedDirectory);
    online = false;
    current = await launch(skippedDirectory);
    const skippedWelcome = current.page.getByRole('dialog', { name: '欢迎使用 · 岚连' });
    await expect(skippedWelcome).toBeVisible();
    const release = { status: 'available', currentVersion: require('../package.json').version, latestVersion: '99.1.0', notes: '本机更新模拟', releaseUrl: 'https://github.com/PowerT-0704/CampusLink/releases/tag/v99.1.0' };
    await current.app.evaluate(({ BrowserWindow }, state) => BrowserWindow.getAllWindows()[0].webContents.send('campus:update', state), release);
    await expect(current.page.getByRole('dialog', { name: '岚连有新版本了' })).toHaveCount(0);
    await current.page.keyboard.press('Escape');
    await expect(skippedWelcome).not.toBeVisible();
    await expect(current.page.getByRole('dialog', { name: '岚连有新版本了' })).toBeVisible();
    await current.page.getByRole('button', { name: '关闭更新内容', exact: true }).click();
    await current.page.getByRole('button', { name: '应用设置', exact: true }).click();
    const managerButton = current.page.getByRole('button', { name: '管理账号密码', exact: true });
    await managerButton.click();
    let manager = current.page.getByRole('dialog', { name: '管理账号与密码' });
    await expect(manager).toBeVisible();
    await expectFocusInside(current.page, manager);
    await manager.getByLabel('登录密码', { exact: true }).fill('discarded-fixture-secret');
    await manager.getByRole('button', { name: '显示密码', exact: true }).click();
    await current.page.keyboard.press('Escape');
    await expect(manager).not.toBeVisible();
    await expect(managerButton).toBeFocused();
    await managerButton.click();
    manager = current.page.getByRole('dialog', { name: '管理账号与密码' });
    await expect(manager.getByLabel('登录密码', { exact: true })).toHaveValue('');
    await expect(manager.getByLabel('登录密码', { exact: true })).toHaveAttribute('type', 'password');
    await current.app.evaluate(({ BrowserWindow }, state) => BrowserWindow.getAllWindows()[0].webContents.send('campus:update', state), { ...release, latestVersion: '99.2.0' });
    await expect(current.page.getByRole('dialog', { name: '岚连有新版本了' })).toHaveCount(0);
    await current.page.keyboard.press('Escape');
    await expect(current.page.getByRole('dialog', { name: '岚连有新版本了' })).toBeVisible();
    await current.page.getByRole('button', { name: '关闭更新内容', exact: true }).click();
    await close(current.app);
    current = await launch(skippedDirectory);
    await expect.poll(() => current.page.evaluate(async () => (await window.campus.getSnapshot()).app.firstRun)).toBe(false);
    await expect(current.page.getByRole('dialog', { name: '欢迎使用 · 岚连' })).toHaveCount(0);
    await close(current.app);

    const sessionDirectory = path.join(temporary, 'session');
    seed(sessionDirectory);
    online = false;
    current = await launch(sessionDirectory);
    const sessionWelcome = current.page.getByRole('dialog', { name: '欢迎使用 · 岚连' });
    await expect(sessionWelcome).toBeVisible();
    await sessionWelcome.getByLabel('校园网账号', { exact: true }).fill('session-fixture-account');
    await sessionWelcome.getByLabel('登录密码', { exact: true }).fill('session-fixture-secret');
    await sessionWelcome.getByRole('button', { name: '保存并开始', exact: true }).click();
    await expect(sessionWelcome).not.toBeVisible();
    await current.page.getByRole('button', { name: '连接校园网', exact: true }).click();
    await expect.poll(() => current.page.evaluate(async () => (await window.campus.getSnapshot()).connection.status)).toBe('connected');
    const sessionDisk = fs.readFileSync(path.join(sessionDirectory, 'settings.json'), 'utf8');
    assert.equal(JSON.parse(sessionDisk).credential, null);
    assert.equal(sessionDisk.includes('session-fixture-secret'), false);
    await close(current.app);
    current = await launch(sessionDirectory);
    const afterRestart = await current.page.evaluate(() => window.campus.getSnapshot());
    assert.equal(afterRestart.credentialStatus.available, false);
    assert.equal(afterRestart.app.firstRun, false);
    await close(current.app);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ platform: process.platform, nativeEncryptedRestarts: 3, nativeReconnect: true, nativeUpgradeMigrations: ['plaintext', 'encrypted'], focusTrap: true, escapeAndFocusRestore: true, transientPasswordCleared: true, updateDialogsDeferred: true, skippedOnboardingPersists: true, sessionOnlyNotPersisted: true, pageErrors: errors }, null, 2));
    console.log('Credential desktop acceptance passed: native persistence, reconnect, onboarding, keyboard dialogs, password cleanup and deferred update prompts.');
  } finally {
    for (const app of apps) await app.close().catch(() => {});
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('campuslink-native-credentials-')) throw new Error('Unexpected test data path');
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
