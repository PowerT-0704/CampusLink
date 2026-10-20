// Desktop integration smoke: no real login/logout requests. Use a fresh, isolated profile.
const { _electron: electron, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const http = require('node:http');

(async () => {
  const root = path.resolve(__dirname, '..');
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-link-smoke-'));
  let online = true;
  let rejectLogin = true;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ path: request.url, body });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/login' && rejectLogin) {
      response.statusCode = 203;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<html><body>Error code: 203 Bad request(2) local-smoke-account local-smoke-secret<script>window.responseExecuted=true</script></body></html>');
    }
    else if (request.url === '/api/login') { online = true; response.end(JSON.stringify({ success: true })); }
    else if (request.url === '/api/logout') { online = false; response.end(JSON.stringify({ success: true })); }
    else response.end(JSON.stringify({ online }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const mockOrigin = `http://127.0.0.1:${server.address().port}`;
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'examples/custom-campus.example.json'), 'utf8'));
  fixture.id = 'local-test-campus'; fixture.name = '本机测试大学'; fixture.homepage = `${mockOrigin}/`;
  for (const operation of Object.values(fixture.operations)) operation.url = operation.url.replace('https://campus.example.invalid', mockOrigin);
  const fixturePath = path.join(dataDirectory, 'local-fixture.json');
  const exportPath = path.join(dataDirectory, 'exported-example.json');
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  const startupProfile = { ...fixture, id: 'startup-test-campus', name: '启动检测测试大学' };
  fs.writeFileSync(path.join(dataDirectory, 'settings.json'), JSON.stringify({ version: 1,
    settings: { profileId: startupProfile.id, username: '', parameters: { operator: 'campus' }, rememberPassword: false, autoLaunch: false, autoConnect: false, minimizeToTray: true },
    profiles: [startupProfile], credential: null,
  }));
  // Isolate onboarding and all startup reads to the same local mock portal.
  const welcomeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-link-welcome-'));
  fs.writeFileSync(path.join(welcomeDirectory, 'settings.json'), JSON.stringify({ version: 1,
    settings: { profileId: startupProfile.id, username: '', parameters: { operator: 'campus' }, rememberPassword: false, autoLaunch: false, autoConnect: false, minimizeToTray: true },
    profiles: [startupProfile], credential: null, onboardingComplete: false,
  }));
  const welcomeEnv = { ...process.env, CAMPUS_LINK_DATA_DIR: welcomeDirectory };
  delete welcomeEnv.ELECTRON_RUN_AS_NODE;
  delete welcomeEnv.VITE_DEV_SERVER_URL;
  delete welcomeEnv.CAMPUS_LINK_LEGACY_DATA_DIR;
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const welcomeApp = await electron.launch({ args: [root], cwd: root, env: welcomeEnv });
  try {
    const welcomePage = await welcomeApp.firstWindow();
    const welcomeDialog = welcomePage.getByRole('dialog', { name: '欢迎使用 · 岚连' });
    await expect(welcomeDialog).toBeVisible();
    assert.equal((await welcomePage.evaluate(() => window.campus.getSnapshot())).app.firstRun, true);
    await welcomeDialog.getByLabel('校园网账号', { exact: true }).fill('welcome-account');
    await welcomeDialog.getByLabel('登录密码', { exact: true }).fill('welcome-secret');
    await expect(welcomeDialog.getByRole('checkbox', { name: /记住密码/ })).not.toBeChecked();
    await welcomeDialog.getByRole('checkbox', { name: /记住密码/ }).check();
    await welcomeDialog.getByLabel('断连检测间隔（秒）', { exact: true }).fill('10');
    await welcomePage.screenshot({ path: path.join(root, 'artifacts/welcome-dialog.png') });
    await welcomePage.getByRole('button', { name: '保存并开始', exact: true }).click();
    await expect(welcomeDialog).not.toBeVisible();
    const welcomeSaved = JSON.parse(fs.readFileSync(path.join(welcomeDirectory, 'settings.json'), 'utf8'));
    assert.equal(welcomeSaved.settings.username, 'welcome-account');
    assert.equal(welcomeSaved.settings.reconnectIntervalSeconds, 10);
    assert.equal(welcomeSaved.credential.password, undefined);
    assert.equal(await welcomeApp.evaluate(({ safeStorage }, encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')), welcomeSaved.credential.encrypted), 'welcome-secret');
    const fresh = await welcomePage.evaluate(() => window.campus.getSnapshot());
    assert.equal(fresh.settings.profileId, startupProfile.id);
    await welcomePage.getByRole('button', { name: '连接方案', exact: false }).first().click();
    const search = welcomePage.getByRole('searchbox', { name: '搜索连接方案' });
    await search.fill('四川');
    await expect(welcomePage.locator('.profile-card')).toHaveCount(1);
    await search.fill('');
    await expect(welcomePage.getByRole('button', { name: /展开更多内置方案/ })).toBeVisible();
    await welcomePage.screenshot({ path: path.join(root, 'artifacts/welcome-firstrun.png'), fullPage: true });
  } finally { await welcomeApp.close().catch(() => {}); }
  const env = { ...process.env, CAMPUS_LINK_DATA_DIR: dataDirectory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  delete env.CAMPUS_LINK_LEGACY_DATA_DIR;
  const app = await electron.launch({ args: [root], cwd: root, env });
  try {
    const page = await app.firstWindow();
    const nativeClipboardAvailable = await app.evaluate(({ clipboard }) => {
      const previous = clipboard.readText();
      const marker = 'CampusLink desktop clipboard availability check';
      clipboard.writeText(marker);
      const available = clipboard.readText() === marker;
      if (available) clipboard.writeText(previous);
      return available;
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByRole('heading', { name: '校园生活，即刻在线.' })).toBeVisible();
    assert.equal(await page.getByRole('heading', { name: '先选择你的校园连接方案' }).count(), 0, '已有配置沿用用户选择的方案');
    const security = await page.evaluate(() => ({ hasBridge: Boolean(window.campus), nodeAccess: typeof window.require }));
    assert.equal(security.hasBridge, true);
    assert.equal(security.nodeAccess, 'undefined');
    // 导航滑块（默认液态）：切换标签后高亮滑块与激活项对齐。
    await page.getByRole('button', { name: '连接方案', exact: false }).first().click();
    await page.waitForTimeout(420);
    const initialGlider = await page.locator('.nav-glider').boundingBox();
    const initialActive = await page.locator('.nav-item.active').boundingBox();
    assert.ok(initialGlider && initialActive && Math.abs(initialGlider.y - initialActive.y) <= 2, '导航滑块与激活项对齐（默认液态）');
    await page.getByRole('button', { name: '连接概览', exact: true }).click();
    await expect(page.getByRole('heading', { name: '已登录校园网', exact: true })).toBeVisible();
    const initial = await page.evaluate(async () => { const s = await window.campus.getSnapshot(); return { autoConnect: s.settings.autoConnect, hasPassword: s.hasPassword, status: s.connection.status }; });
    assert.deepEqual(initial, { autoConnect: false, hasPassword: false, status: 'connected' });
    await expect(page.getByLabel('校园网账号', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('登录密码', { exact: true })).toHaveCount(0);
    assert.equal(requests.every(request => request.path === '/api/status'), true, 'Startup only performs status reads');
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'artifacts/desktop-online-mock.png'), fullPage: true });
    online = false; // Simulate a browser logout without sending a real logout request.
    await page.getByRole('button', { name: '检测网络', exact: true }).click();
    await page.getByRole('button', { name: '连接校园网', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('请先填写校园网账号');
    await page.getByRole('button', { name: '关闭提示' }).click();
    await page.getByRole('button', { name: '连接方案', exact: false }).first().click();
    await page.getByRole('button', { name: /展开更多内置方案/ }).click();
    await expect(page.getByRole('heading', { name: '贵州轻工职业大学', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '四川大学 · 锐捷 ePortal', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '活动日志', exact: true }).click();
    await expect(page.getByRole('heading', { name: '运行记录' })).toBeVisible();
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: '岚连 · CDUTYB 专版', exact: true })).toBeVisible();
    await page.getByRole('switch', { name: '开机自启动', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('开发预览不注册开机自启动');
    await page.getByRole('button', { name: '关闭提示' }).click();
    await page.getByRole('switch', { name: '启动后自动连接', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('请先');
    await page.getByRole('button', { name: '关闭提示' }).click();
    await page.getByRole('button', { name: '开发日志', exact: true }).click();
    await expect(page.getByRole('heading', { name: '版本记录' })).toBeVisible();
    await expect(page.locator('.journal-entry').first()).toContainText(`v${require('../package.json').version}`);
    await expect(page.getByText(/NingMeng123/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '打开上游仓库', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '连接概览', exact: true }).click();
    await page.getByRole('button', { name: '使用帮助', exact: false }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: '开始使用' }).click();
    // Exercise native file bridge and authentication only against the local test server.
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.fixturePath] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.exportPath });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, { fixturePath, exportPath });
    await page.getByRole('button', { name: '连接方案', exact: false }).first().click();
    await page.getByRole('button', { name: '导出方案示例' }).click();
    await expect.poll(() => fs.existsSync(exportPath)).toBe(true);
    assert.deepEqual(JSON.parse(fs.readFileSync(exportPath, 'utf8')), JSON.parse(fs.readFileSync(path.join(root, 'examples/custom-campus.example.json'), 'utf8')));
    await page.getByRole('button', { name: '导出锐捷示例', exact: true }).click();
    await expect.poll(() => JSON.parse(fs.readFileSync(exportPath, 'utf8')).protocol).toBe('ruijie');
    assert.deepEqual(JSON.parse(fs.readFileSync(exportPath, 'utf8')), JSON.parse(fs.readFileSync(path.join(root, 'examples/ruijie-campus.example.json'), 'utf8')));
    // Per-card exports must be actual, re-importable definitions, not examples
    // or public snapshots that omit protocol configuration.
    for (const [name, protocol] of [['四川大学 · 锐捷 ePortal', 'ruijie'], ['贵州轻工职业大学', 'drcom']]) {
      await page.getByRole('button', { name: `导出${name}方案 JSON`, exact: true }).click();
      await expect.poll(() => JSON.parse(fs.readFileSync(exportPath, 'utf8')).protocol).toBe(protocol);
      const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
      assert.equal(exported.id.startsWith('builtin-'), false);
      assert.deepEqual(require('../electron/profiles.cjs').parseProfile(JSON.stringify(exported)), exported);
      if (protocol === 'ruijie') assert.ok(exported.ruijie.publicKey.modulus);
    }
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, exportPath);
    await page.getByRole('button', { name: '导入连接方案', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.campus.getSnapshot())).profiles.some(p => p.id === 'gzqy-copy')).toBe(true);
    await page.evaluate(() => window.campus.removeProfile('gzqy-copy'));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, fixturePath);
    await page.getByRole('button', { name: '导入连接方案', exact: true }).click();
    await expect(page.getByRole('heading', { name: fixture.name, exact: true })).toBeVisible();
    await page.locator('article').filter({ has: page.getByRole('heading', { name: fixture.name, exact: true }) }).getByRole('button', { name: '使用此方案', exact: true }).click();
    await page.getByRole('button', { name: '连接概览', exact: true }).click();
    await page.getByLabel('校园网账号', { exact: true }).fill('local-smoke-account');
    await page.getByLabel('登录密码', { exact: true }).fill('local-smoke-secret');
    await page.getByRole('checkbox', { name: '记住密码' }).check();
    await page.getByRole('button', { name: '连接校园网', exact: true }).click();
    await page.getByRole('button', { name: '查看响应', exact: true }).first().click();
    const responseDialog = page.getByRole('dialog', { name: '服务器响应', exact: true });
    await expect(responseDialog).toBeVisible();
    await expect(responseDialog).toContainText('HTTP 203');
    await expect(responseDialog.getByLabel('请求 1 响应正文')).toContainText('Bad request(2)');
    await expect(responseDialog).not.toContainText('local-smoke-secret');
    await expect(responseDialog).not.toContainText('local-smoke-account');
    assert.equal(await page.evaluate(() => window.responseExecuted), undefined);
    await page.screenshot({ path: path.join(root, 'artifacts/response-details.png') });
    await app.evaluate(({ clipboard }) => {
      const originalWrite = clipboard.writeText.bind(clipboard);
      clipboard.writeText = (...args) => { global.__smokeClipboardWrite = args[0]; return originalWrite(...args); };
    });
    // The OS clipboard is shared with other desktop apps. Retry the complete
    // copy/read interaction if its contents change before we can observe it.
    await expect(async () => {
      await page.getByRole('button', { name: '复制详情', exact: true }).click();
      await expect(responseDialog).toContainText('已复制');
      const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
      const bridgeWrite = await app.evaluate(() => global.__smokeClipboardWrite || '');
      assert.ok(bridgeWrite.includes('Bad request(2)'), 'The native clipboard bridge receives redacted response details');
      if (nativeClipboardAvailable) assert.ok(clipboard.includes('Bad request(2)'));
      assert.equal(bridgeWrite.includes('local-smoke-secret'), false);
      assert.equal(clipboard.includes('local-smoke-secret'), false);
    }).toPass({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(responseDialog).not.toBeVisible();
    await page.getByRole('button', { name: '活动日志', exact: true }).click();
    await page.getByRole('button', { name: '查看响应', exact: true }).first().click();
    await expect(responseDialog).toBeVisible();
    await page.getByRole('button', { name: '关闭响应详情' }).click();
    await page.getByRole('button', { name: '连接概览', exact: true }).click();
    rejectLogin = false;
    await page.getByRole('button', { name: '连接校园网', exact: true }).click();
    await expect(page.getByRole('button', { name: '注销校园网', exact: true })).toBeVisible();
    await expect(page.locator('.session-details')).toContainText('当前账号');
    await expect(page.locator('.session-details')).toContainText('local-smoke-account');
    assert.equal(online, true);
    assert.equal(new URLSearchParams(requests.find(item => item.path === '/api/login').body).get('password'), 'local-smoke-secret');
    const savedLogin = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'settings.json'), 'utf8'));
    assert.equal(savedLogin.credential.password, undefined);
    assert.equal(await app.evaluate(({ safeStorage }, encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')), savedLogin.credential.encrypted), 'local-smoke-secret');
    assert.equal(JSON.stringify(savedLogin.settings).includes('local-smoke-secret'), false, '设置字段不会包含密码');
    await page.getByRole('switch', { name: '启动后自动连接', exact: true }).click();
    await expect(page.getByRole('switch', { name: '启动后自动连接', exact: true })).toBeChecked();
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await expect(page.getByRole('switch', { name: '断线自动重连', exact: true })).toBeChecked();
    await expect(page.getByLabel('检测间隔（秒）', { exact: true })).toHaveValue('10');
    await page.getByLabel('检测间隔（秒）', { exact: true }).fill('5');
    await page.getByRole('button', { name: '保存间隔', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.campus.getSnapshot())).settings.reconnectIntervalSeconds).toBe(5);
    await page.getByRole('button', { name: '连接概览', exact: true }).click();
    const loginCount = requests.filter(request => request.path === '/api/login').length;
    online = false;
    await expect.poll(() => requests.filter(request => request.path === '/api/login').length, { timeout: 12000 }).toBe(loginCount + 1);
    await expect(page.getByRole('heading', { name: '已登录校园网', exact: true })).toBeVisible();
    assert.equal(online, true, 'A confirmed outage reconnects with the saved session');
    await expect.poll(async () => (await page.evaluate(() => window.campus.getSnapshot())).connection.monitoring).toBe(true);
    await page.getByRole('button', { name: '注销校园网', exact: true }).click();
    await expect(page.getByRole('button', { name: '连接校园网', exact: true })).toBeVisible();
    assert.equal(online, false);
    const paused = await page.evaluate(() => window.campus.getSnapshot());
    assert.equal(paused.connection.reconnectPaused, true);
    assert.equal(paused.connection.monitoring, false);
    const requestsAfterLogout = requests.length;
    await new Promise(resolve => setTimeout(resolve, 5500));
    assert.equal(requests.length, requestsAfterLogout, 'Manual logout stops both monitoring and reconnection');
    assert.equal(online, false);
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await page.getByRole('button', { name: '导出诊断包', exact: true }).click();
    await expect.poll(() => { try { return JSON.parse(fs.readFileSync(exportPath, 'utf8')).format; } catch { return null; } }).toBe('campuslink-diagnostics');
    const diagnostics = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    assert.equal(JSON.stringify(diagnostics).includes('local-smoke-secret'), false);
    assert.equal(JSON.stringify(diagnostics).includes('local-smoke-account'), false);
    assert.ok(diagnostics.settings.username.startsWith('lo'));
    if (await page.getByRole('button', { name: '关闭提示' }).count()) await page.getByRole('button', { name: '关闭提示' }).click();
    // 密码管理从未记住密码的状态保存，并清除概览中旧的未提交密码。
    await page.getByRole('button', { name: '清除密码', exact: true }).click();
    assert.equal((await page.evaluate(() => window.campus.getSnapshot())).settings.rememberPassword, false);
    await page.getByRole('button', { name: '连接概览', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: '记住密码' })).not.toBeChecked();
    await page.getByLabel('登录密码', { exact: true }).fill('stale-unsaved-secret');
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await page.getByRole('button', { name: '管理账号密码', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '管理账号与密码' })).toBeVisible();
    await page.getByLabel('校园网账号', { exact: true }).fill('managed-account');
    await page.getByLabel('登录密码', { exact: true }).fill('managed-secret');
    await page.screenshot({ path: path.join(root, 'artifacts/password-manager.png') });
    await page.getByRole('button', { name: '保存账号密码', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.campus.getSnapshot())).settings.username).toBe('managed-account');
    assert.equal((await page.evaluate(() => window.campus.getSnapshot())).hasPassword, true);
    const savedManaged = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'settings.json'), 'utf8'));
    assert.equal(savedManaged.credential.password, undefined);
    assert.equal(await app.evaluate(({ safeStorage }, encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')), savedManaged.credential.encrypted), 'managed-secret');
    await page.getByRole('switch', { name: '启动后自动连接', exact: true }).click();
    await expect(page.getByRole('switch', { name: '启动后自动连接', exact: true })).toBeChecked();
    await page.getByRole('button', { name: '连接概览', exact: true }).click();
    await expect(page.getByLabel('校园网账号', { exact: true })).toHaveValue('managed-account');
    await expect(page.getByLabel('登录密码', { exact: true })).toHaveValue('');
    await expect(page.getByRole('checkbox', { name: '记住密码' })).toBeChecked();
    await page.getByRole('button', { name: '连接校园网', exact: true }).click();
    await expect(page.getByRole('heading', { name: '已登录校园网', exact: true })).toBeVisible();
    const managedConnected = await page.evaluate(() => window.campus.getSnapshot());
    assert.equal(managedConnected.settings.rememberPassword, true, '连接沿用密码管理保存的记住密码设置');
    assert.equal(managedConnected.settings.autoConnect, true, '连接保留已开启的自动连接设置');
    assert.equal(managedConnected.hasPassword, true, '连接不会清除密码管理保存的凭据');
    assert.equal(new URLSearchParams(requests.filter(item => item.path === '/api/login').at(-1).body).get('password'), 'managed-secret', '连接使用新保存的密码，而非旧的未提交输入');
    const managedAfterConnect = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'settings.json'), 'utf8'));
    assert.equal(managedAfterConnect.credential.encrypted, savedManaged.credential.encrypted);
    assert.equal(JSON.stringify(managedAfterConnect.settings).includes('managed-secret'), false);
    await page.getByRole('button', { name: '注销校园网', exact: true }).click();
    await expect(page.getByRole('button', { name: '连接校园网', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await page.getByRole('button', { name: '清除密码', exact: true }).click();
    await expect(page.getByRole('switch', { name: '启动后自动连接', exact: true })).not.toBeChecked();
    await expect(page.getByRole('button', { name: '清除密码', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '连接方案', exact: false }).first().click();
    await page.getByRole('button', { name: `删除${fixture.name}方案` }).click();
    await page.getByRole('button', { name: '确认移除' }).click();
    await expect(page.getByRole('heading', { name: fixture.name, exact: true })).not.toBeVisible();
    assert.equal((await page.evaluate(() => window.campus.getSnapshot())).settings.profileId, 'builtin-cdut-yibin-ruijie', '删除所选方案后回退到默认的宜宾校区方案');
    await page.getByRole('button', { name: '连接概览', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '连接方案' })).toHaveValue('builtin-cdut-yibin-ruijie');
    await expect(page.getByRole('button', { name: '检测网络', exact: true })).toBeEnabled();
    if (await page.getByRole('button', { name: '关闭提示' }).count()) await page.getByRole('button', { name: '关闭提示' }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 720));
    await page.screenshot({ path: path.join(root, 'artifacts/desktop-compact.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'No horizontal overflow at minimum window size');
    assert.deepEqual(errors, []);
    // 默认界面为液态玻璃：验证液态形态与独立滚动；再切到经典验证整页滚动吸顶与经典滑块；最后切回液态。
    const glassSupported = process.platform === 'win32' && Number(String(os.release()).split('.')[2] || '0') >= 22000;
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.appearance), 'liquid', '默认界面为液态玻璃');
    await expect(page.locator('.lg-panel')).toBeVisible();
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.lg-panel')).backgroundColor), 'rgba(0, 0, 0, 0)', '玻璃面板纯透光、无自带底色');
    await expect(page.locator('.lg-topbar')).toBeVisible();
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.titlebar')).backgroundColor), 'rgba(0, 0, 0, 0)', '液态模式标题栏透明、无横条');
    const sidebarBox = await page.locator('.sidebar').boundingBox();
    const topbarBox = await page.locator('.lg-topbar').boundingBox();
    assert.ok(sidebarBox && topbarBox && Math.abs(topbarBox.x - (sidebarBox.x + sidebarBox.width - 8)) <= 1, '顶栏玻璃从侧边栏右缘开始、不再重叠');
    assert.ok(topbarBox && Math.abs(topbarBox.height - 48) <= 1, '顶栏玻璃收窄为 48px');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.lg-panel')).borderTopRightRadius), '20px', '侧边栏四角均为圆弧（20px）');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.lg-topbar')).borderTopLeftRadius), '20px', '顶栏左端同为圆弧（20px）');
    assert.equal(await page.evaluate(() => Math.round(document.querySelector('main').getBoundingClientRect().top)), 56, '内容区从顶栏玻璃下方开始、不被压缩');
    await page.waitForTimeout(400);
    const liquidGlider = await page.locator('.nav-glider').boundingBox();
    const liquidActive = await page.locator('.nav-item.active').boundingBox();
    assert.ok(liquidGlider && liquidActive && Math.abs(liquidGlider.y - liquidActive.y) <= 2, '导航滑块与激活项对齐（液态）');
    assert.equal((await page.evaluate(() => window.campus.getSnapshot())).app.windowGlass, glassSupported);
    if (glassSupported) console.log('background color (liquid):', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor()));
    await page.screenshot({ path: path.join(root, 'artifacts/liquid-settings.png') });
    await page.getByRole('button', { name: '连接概览', exact: true }).click();
    // 液态滚动模型：整页不滚动，内容在玻璃下方独立滚动，顶栏保持固定。
    assert.equal(await page.evaluate(() => window.scrollY), 0, '液态模式整页不滚动');
    await page.evaluate(() => { document.querySelector('main').scrollTo(0, 260); });
    await page.waitForTimeout(150);
    assert.ok(await page.evaluate(() => document.querySelector('main').scrollTop) > 0, '内容区在玻璃下方独立滚动');
    const topbarScrolledBox = await page.locator('.lg-topbar').boundingBox();
    assert.ok(topbarScrolledBox && Math.abs(topbarScrolledBox.y - 8) <= 1, '滚动时顶栏保持固定');
    await page.screenshot({ path: path.join(root, 'artifacts/desktop-liquid-scrolled.png') });
    await page.evaluate(() => { document.querySelector('main').scrollTo(0, 0); });
    await page.screenshot({ path: path.join(root, 'artifacts/desktop-liquid.png'), fullPage: true });
    // 切到经典：验证白色标题栏、无顶栏、整页滚动吸顶与经典导航滑块。
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await page.evaluate(() => { window.__fxSeen = false; const shell = document.querySelector('.app-shell'); new MutationObserver(() => { if (/appearance-enter-/.test(shell.className)) window.__fxSeen = true; }).observe(shell, { attributes: true, attributeFilter: ['class'] }); });
    await page.getByRole('switch', { name: '界面外观：液态玻璃', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__fxSeen))).toBe(true);
    await expect.poll(() => page.evaluate(() => /appearance-enter-/.test(document.querySelector('.app-shell').className)), { timeout: 2500 }).toBe(false);
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'classic');
    await expect(page.locator('.lg-panel')).toHaveCount(0);
    assert.equal(await page.locator('.lg-topbar').count(), 0, '经典模式无贯通顶栏');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.titlebar')).backgroundColor), 'rgb(251, 252, 252)', '经典模式标题栏保持原样');
    assert.equal((await page.evaluate(() => window.campus.getSnapshot())).app.windowGlass, false);
    if (glassSupported) console.log('background color (classic):', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor()));
    await page.getByRole('button', { name: '连接概览', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 500));
    const titlebarBox = await page.locator('.titlebar').boundingBox();
    assert.ok(titlebarBox && titlebarBox.y >= 0 && titlebarBox.y < 2, 'Titlebar stays pinned while scrolling（经典）');
    await page.screenshot({ path: path.join(root, 'artifacts/titlebar-sticky.png') });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(420);
    const classicGlider = await page.locator('.nav-glider').boundingBox();
    const classicActive = await page.locator('.nav-item.active').boundingBox();
    assert.ok(classicGlider && classicActive && Math.abs(classicGlider.y - classicActive.y) <= 2, '导航滑块与激活项对齐（经典）');
    // 切回液态，保持默认终态。
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await page.getByRole('switch', { name: '界面外观：液态玻璃', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'liquid');
    await expect(page.locator('.lg-panel')).toBeVisible();
    // Closing with the tray preference disabled must actually quit, without changing network state.
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    // Stub only the network boundary; exercise the checker state, IPC events,
    // renderer prompt and validated external download target end to end.
    await app.evaluate(({ shell }, directory) => {
      const requireModule = process.getBuiltinModule('node:module').createRequire(`${directory}/package.json`);
      const { UpdateChecker } = requireModule('./electron/updates.cjs');
      UpdateChecker.prototype.fetchRelease = async function () {
        return { status: 'available', currentVersion: this.currentVersion, latestVersion: '99.1.0', releaseUrl: 'https://github.com/PowerT-0704/CampusLink/releases/tag/v99.1.0', notes: '更新模拟内容\n<script>window.releaseExecuted=true</script>', publishedAt: '2026-10-12T00:00:00.000Z' };
      };
      shell.openExternal = async url => { global.__smokeReleaseUrl = url; };
    }, root);
    await page.getByRole('button', { name: '检查更新', exact: true }).click();
    const updateDialog = page.getByRole('dialog', { name: '岚连有新版本了', exact: true });
    await expect(updateDialog).toBeVisible();
    await expect(updateDialog).toContainText('99.1.0');
    await expect(updateDialog).toContainText('<script>window.releaseExecuted=true</script>');
    assert.equal(await page.evaluate(() => window.releaseExecuted), undefined);
    await updateDialog.getByRole('button', { name: '前往 Releases 下载', exact: true }).click();
    assert.equal(await app.evaluate(() => global.__smokeReleaseUrl), 'https://github.com/PowerT-0704/CampusLink/releases/tag/v99.1.0');
    await page.getByRole('button', { name: '关闭更新内容', exact: true }).click();
    await page.getByRole('switch', { name: '关闭时最小化到托盘', exact: true }).click();
    const closed = app.waitForEvent('close');
    // 点击关闭后窗口会立即退出，Playwright 可能在该点击结算前收到上下文关闭，属预期行为。
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click().catch(() => {});
    await closed;
    console.log(`Desktop smoke passed: renderer bridge, navigation, profile search and folded built-ins, first-run welcome guide, validation, startup guards, per-profile JSON import/export, local mock authentication, configurable outage reconnection, manual logout pause, response details and redaction, update prompt and Releases navigation, ${nativeClipboardAvailable ? 'native clipboard' : 'clipboard bridge payload (host clipboard unavailable)'}, OS-encrypted credentials with password manager, sticky titlebar, responsive layout, and exit.`);
  } finally { await app.close().catch(() => {}); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exit(1); });
