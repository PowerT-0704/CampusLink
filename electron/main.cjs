'use strict';

const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell, Tray, Menu, nativeImage, session, powerMonitor, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { CampusService } = require('./service.cjs');
const { MAX_PROFILE_BYTES, safeUrl, parseProfile, exportProfile, exportProfileJson } = require('./profiles.cjs');
const { UpdateChecker, safeReleaseUrl } = require('./updates.cjs');
const { buildDiagnosticsReport } = require('./diagnostics-export.cjs');
const { createNetworkWatcher } = require('./network-watch.cjs');
const { migrateLegacyData } = require('./legacy-data.cjs');

app.setName('岚连 · CDUTYB 专版（液态玻璃版）');
app.setAppUserModelId('cn.campuslink.glass');
if (!app.isPackaged && process.env.CAMPUS_LINK_DATA_DIR) app.setPath('userData', path.resolve(process.env.CAMPUS_LINK_DATA_DIR));
const isPrimary = app.requestSingleInstanceLock();
let legacyMigrationFailed = false;
if (isPrimary) {
  const isolatedDevelopment = !app.isPackaged && process.env.CAMPUS_LINK_DATA_DIR;
  const isolatedLegacy = isolatedDevelopment && process.env.CAMPUS_LINK_LEGACY_DATA_DIR;
  if (!isolatedDevelopment || isolatedLegacy) {
    try {
      migrateLegacyData({ sourceDirectory: isolatedLegacy || path.join(app.getPath('appData'), '岚连 · Campus Link'), targetDirectory: app.getPath('userData') });
    } catch { legacyMigrationFailed = true; }
  }
}
let win = null;
let tray = null;
let service = null;
let networkWatcher = null;
let tooltipTimer = null;
let updates = null;
let updateRetry = null;
let lastConnectionStatus = 'idle';
let updateConnectionGeneration = 0;
let quitting = false;
const indexPath = path.resolve(__dirname, '../dist/index.html');
const indexUrl = pathToFileURL(indexPath).href;
let devUrl = null;
if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
  const parsed = new URL(process.env.VITE_DEV_SERVER_URL);
  if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password) throw new Error('开发服务器仅允许本地 HTTP 地址');
  devUrl = parsed;
}

function trusted(event) {
  if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return false;
  const frame = event.senderFrame;
  if (!frame) return false;
  if (devUrl) return frame.origin === devUrl.origin && new URL(frame.url).origin === devUrl.origin;
  // A file origin alone is opaque. Pin the exact document and the owned main frame as well.
  return frame.url.split('#')[0] === indexUrl;
}
function supportsWindowGlass() {
  if (process.platform !== 'win32') return false;
  const build = Number(os.release().split('.')[2] || '0');
  return build >= 22000;
}
function applyWindowGlass() {
  // 液态玻璃模式在 Win11 22H2+ 使用系统 Acrylic 材质，让侧边栏透视桌面；其余情况回退为应用内玻璃。
  if (!service) return;
  const enabled = service.settings.appearance === 'liquid' && supportsWindowGlass();
  let applied = false;
  if (win && !win.isDestroyed() && process.platform === 'win32') {
    try {
      win.setBackgroundMaterial(enabled ? 'acrylic' : 'none');
      win.setBackgroundColor(enabled ? '#00000000' : '#f6f7fb');
      applied = enabled;
    } catch { applied = false; }
  }
  service.appInfo.windowGlass = applied;
}
function registerIpc() {
  const handle = (method, handler) => ipcMain.handle(`campus:${method}`, async (event, ...args) => {
    if (!trusted(event)) throw new Error('已拒绝不受信任的页面请求。');
    return handler(...args);
  });
  handle('getSnapshot', () => service.snapshot());
  handle('getUpdateState', () => updates.snapshot());
  handle('checkForUpdates', () => updates.check());
  handle('openRelease', () => shell.openExternal(safeReleaseUrl(updates.snapshot().releaseUrl)));
  handle('copyText', text => {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw new Error('复制内容无效或过长。');
    clipboard.writeText(text);
  });
  handle('saveSettings', async patch => {
    const previousProfile = service.settings.profileId;
    const snapshot = service.saveSettings(patch);
    return previousProfile !== service.settings.profileId ? service.checkStatus() : snapshot;
  });
  handle('setAppearance', value => {
    if (value !== 'classic' && value !== 'liquid') throw new Error('界面外观设置无效。');
    service.setAppearance(value);
    applyWindowGlass();
    return service.publish();
  });
  handle('saveCredentials', input => service.setCredentials(input));
  handle('completeOnboarding', input => service.completeOnboarding(input));
  handle('retryCredentials', async () => {
    const snapshot = service.retryCredentials();
    return service.busy ? snapshot : service.autoConnectIfEnabled();
  });
  handle('connect', input => service.connect(input));
  handle('disconnect', () => service.disconnect());
  handle('checkStatus', () => service.checkStatus());
  handle('clearCredentials', () => service.clearCredentials());
  handle('removeProfile', id => service.removeProfile(id));
  handle('importProfile', async () => {
    const result = await dialog.showOpenDialog(win, { title: '导入校园网连接方案', properties: ['openFile'], filters: [{ name: '连接方案 JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true, snapshot: service.snapshot() };
    const file = result.filePaths[0];
    if (fs.statSync(file).size > MAX_PROFILE_BYTES) throw new Error('连接方案文件不能超过 64 KB。');
    const text = fs.readFileSync(file, 'utf8');
    const profile = parseProfile(text);
    const discovery = profile.portalDiscovery
      ? `自动发现入口：${profile.portalDiscovery.url}\n应用将探测当前网络的真实认证服务器，并仅向识别出且协议匹配的认证服务器提交账号和密码。\n备用认证页：${profile.homepage}\n\n`
      : '';
    const endpoints = profile.protocol === 'ruijie'
      ? `${profile.portalDiscovery ? '备用网关' : '锐捷'}发现入口：${profile.ruijie.discoveryUrl}\n${profile.portalDiscovery ? '备用网关允许的' : '允许的'}只读发现跳转来源：\n${[new URL(profile.homepage).origin, ...profile.ruijie.redirectOrigins].join('\n')}\n${profile.portalDiscovery ? '备用' : ''}认证接口：${new URL('/eportal/InterFace.do', profile.homepage).href}\n${profile.portalDiscovery ? '' : '账号和加密后的密码只提交到上述认证接口。\n'}服务名称编码：${profile.ruijie.serviceEncoding === 'percent' ? '百分号编码' : '原始文本'}`
      : profile.protocol === 'drcom'
        ? `${profile.portalDiscovery ? '备用' : ''} Dr.COM 接口：\n${['login', 'logout', 'chkstatus'].map(name => `GET ${new URL(`/drcom/${name}`, profile.homepage).href}`).join('\n')}\n使用应用内置的 Dr.COM 请求与状态确认流程。`
        : `请求地址（均与认证页同源）：\n${Object.entries(profile.operations).map(([name, operation]) => `${name}: ${operation.method} ${operation.url}`).join('\n')}`;
    const confirmation = await dialog.showMessageBox(win, {
      type: 'question', title: '确认导入连接方案', message: `导入「${profile.name}」？`,
      detail: `作者：${profile.author || '未填写'}\n版本：${profile.version}\n${profile.portalDiscovery ? '' : `认证页：${profile.homepage}\n\n`}${discovery}${endpoints}\n\n${profile.portalDiscovery ? '自动发现以当前校园网络的认证跳转为依据，请确认连接的是你信任的校园网络。' : '连接时，账号和密码会发送给此方案指定的认证服务器。请确认你信任该方案及其地址。'}`,
      buttons: ['取消', '信任并导入'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (confirmation.response !== 1) return { canceled: true, snapshot: service.snapshot() };
    return { canceled: false, snapshot: service.importProfile(text) };
  });
  handle('exportExample', async (kind = 'http') => {
    if (!['http', 'ruijie'].includes(kind)) throw new Error('方案示例类型无效。');
    const filename = kind === 'ruijie' ? 'ruijie-campus.example.json' : 'custom-campus.example.json';
    const result = await dialog.showSaveDialog(win, { title: kind === 'ruijie' ? '保存锐捷连接方案示例' : '保存 HTTP 连接方案示例', defaultPath: filename, filters: [{ name: '连接方案 JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.copyFileSync(path.join(__dirname, '../examples', filename), result.filePath);
    service.log('success', '连接方案示例已保存。');
    return { canceled: false, path: result.filePath };
  });
  handle('exportDiagnostics', async () => {
    const report = buildDiagnosticsReport(service.snapshot());
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const result = await dialog.showSaveDialog(win, { title: '导出诊断包', defaultPath: `campuslink-diagnostics-${stamp}.json`, filters: [{ name: '诊断包 JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, report, { encoding: 'utf8', mode: 0o600 });
    service.log('success', '诊断包已导出。');
    return { canceled: false, path: result.filePath };
  });
  handle('exportProfile', async id => {
    if (typeof id !== 'string' || !id) throw new Error('请选择要导出的连接方案。');
    // Export the stored definition, never the public snapshot, credentials,
    // current field values or dynamically discovered authentication address.
    const profile = exportProfile(service.profile(id));
    const result = await dialog.showSaveDialog(win, { title: `导出「${profile.name}」连接方案`, defaultPath: `${profile.id}.json`, filters: [{ name: '连接方案 JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, exportProfileJson(profile), { encoding: 'utf8', mode: 0o600 });
    service.log('success', `连接方案「${profile.name}」已导出。`);
    return { canceled: false, path: result.filePath };
  });
  handle('openPortal', async id => {
    const profile = service.profile(id);
    const url = safeUrl(profile.portalDiscovery?.url ?? profile.homepage);
    await shell.openExternal(url.href);
  });
  handle('openUrl', async value => {
    const url = safeUrl(value, '外部链接');
    await shell.openExternal(url.href);
  });
  handle('windowAction', action => {
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
    else throw new Error('窗口操作无效。');
  });
}

function iconImage() {
  const target = path.resolve(__dirname, '../assets/icon.png');
  if (fs.existsSync(target)) {
    const icon = nativeImage.createFromPath(target);
    if (!icon.isEmpty()) return icon;
  }
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 220; pixels[i + 1] = 100; pixels[i + 2] = 66; pixels[i + 3] = 255; }
  return nativeImage.createFromBitmap(pixels, { width: 16, height: 16 });
}
function showWindow() { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } }
async function checkUpdatesAfterConnection() {
  const generation = ++updateConnectionGeneration;
  clearTimeout(updateRetry);
  // The initial query may still be waiting for authentication. Await it first,
  // then respect its actual cooldown before the single post-login retry.
  const result = await updates.check();
  if (quitting || generation !== updateConnectionGeneration || service.connection.status !== 'connected' || result.status !== 'error') return;
  updateRetry = setTimeout(() => {
    if (!quitting && generation === updateConnectionGeneration && service.connection.status === 'connected') void updates.check();
  }, updates.retryDelayMs() + 25);
  updateRetry.unref?.();
}
function trayAction(action) {
  Promise.resolve().then(action).catch(() => service.log('warning', '操作未完成，请打开主窗口检查当前设置。'));
}
function ipv4ToInt(value) {
  const parts = String(value).split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return 0;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}
function activeIPv4(portalUrl) {
  // 优先选择与认证服务器同网段的活动网卡地址（锐捷适配器不上报客户端 IP）。
  try {
    const candidates = [];
    for (const addresses of Object.values(os.networkInterfaces() || {})) {
      for (const address of addresses || []) {
        if (address.internal || (address.family !== 'IPv4' && address.family !== 4)) continue;
        candidates.push({ address: address.address, netmask: address.netmask || '' });
      }
    }
    const target = portalUrl ? new URL(portalUrl).hostname : '';
    if (/^\d+\.\d+\.\d+\.\d+$/.test(target)) {
      const targetValue = ipv4ToInt(target);
      const same = candidates.find(item => item.netmask && (ipv4ToInt(item.address) & ipv4ToInt(item.netmask)) === (targetValue & ipv4ToInt(item.netmask)));
      if (same) return same.address;
    }
    return candidates[0]?.address || '';
  } catch { return ''; }
}
function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}
function trayTooltip(snapshot) {
  if (snapshot.connection.status !== 'connected') return '岚连 · CDUTYB 专版 · 校园网连接工具';
  let portalUrl = '';
  try { portalUrl = service.profile().homepage; } catch { /* 方案异常时退回本机网卡地址 */ }
  const ip = snapshot.connection.ip || activeIPv4(portalUrl);
  const since = typeof snapshot.connection.since === 'string' ? Date.parse(snapshot.connection.since) : NaN;
  const duration = Number.isFinite(since) ? formatDuration(Date.now() - since) : '';
  return ['岚连 · CDUTYB 专版 · 已连接', ip ? `IP ${ip}` : '', duration ? `在线 ${duration}` : ''].filter(Boolean).join(' ｜ ');
}
function updateTray(snapshot) {
  if (!tray || tray.isDestroyed()) return;
  const busy = snapshot.connection.refreshing || ['checking', 'connecting', 'disconnecting'].includes(snapshot.connection.status);
  const connected = snapshot.connection.status === 'connected';
  tray.setToolTip(trayTooltip(snapshot));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开岚连 · CDUTYB 专版', click: showWindow },
    { type: 'separator' },
    { label: '查询认证状态', enabled: !busy && Boolean(snapshot.settings.profileId), click: () => trayAction(() => service.checkStatus()) },
    { label: snapshot.connection.reconnectPaused ? '恢复守护' : '暂停守护', enabled: snapshot.connection.reconnectPaused || (snapshot.settings.autoReconnect && connected), click: () => trayAction(() => service.setGuardPaused(!service.reconnectPaused)) },
    { label: '连接校园网', enabled: !busy && Boolean(snapshot.settings.profileId) && !snapshot.connection.canDisconnect && snapshot.credentialStatus.available, click: () => trayAction(() => service.connect({})) },
    { label: '断开认证', enabled: !busy && snapshot.connection.canDisconnect, click: () => trayAction(() => service.disconnect()) },
    { type: 'separator' },
    { label: '退出岚连 · CDUTYB 专版', click: () => { quitting = true; app.quit(); } },
  ]));
}
function configureSession() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', event => event.preventDefault());
  const connect = devUrl ? `'self' ${devUrl.origin} ws://${devUrl.host}` : "'none'";
  const script = devUrl ? "'self' 'unsafe-inline'" : "'self'";
  const csp = `default-src 'self'; script-src ${script}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src ${connect}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'`;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
}
function createWindow() {
  win = new BrowserWindow({
    width: 1260, height: 850, minWidth: 1000, minHeight: 720, show: false, frame: false,
    title: '岚连 · CDUTYB 专版', backgroundColor: '#f6f7fb', icon: iconImage(),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false, devTools: !app.isPackaged },
  });
  if (process.platform !== 'darwin') win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.once('ready-to-show', () => {
    const openedAtLogin = process.argv.includes('--autostart') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);
    if (!openedAtLogin) win.show();
  });
  win.on('focus', () => { if (service) void service.refreshStatus().catch(() => {}); });
  win.on('close', event => {
    if (!quitting && service.settings.minimizeToTray && tray) { event.preventDefault(); win.hide(); }
    else quitting = true;
  });
  win.on('closed', () => { win = null; });
  win.webContents.once('did-finish-load', () => { if (app.isPackaged && !quitting) void updates.check(); });
  if (devUrl) win.loadURL(devUrl.href); else win.loadFile(indexPath);
  applyWindowGlass();
}

if (!isPrimary) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { quitting = true; clearTimeout(updateRetry); if (tooltipTimer) { clearInterval(tooltipTimer); tooltipTimer = null; } networkWatcher?.stop(); service?.dispose(); });
  app.on('window-all-closed', () => { if (!tray || quitting) app.quit(); });
  app.on('activate', showWindow);
  app.whenReady().then(() => {
    updates = new UpdateChecker({ currentVersion: app.getVersion() });
    updates.on('change', state => { if (win && !win.isDestroyed()) win.webContents.send('campus:update', state); });
    const settingsFile = path.join(app.getPath('userData'), 'settings.json');
    const freshInstall = !fs.existsSync(settingsFile);
    service = new CampusService({
      directory: app.getPath('userData'), safeStorage, version: app.getVersion(), packaged: app.isPackaged, firstRun: freshInstall,
      readAutoLaunch: () => app.isPackaged && app.getLoginItemSettings(process.platform === 'win32' ? { path: process.execPath, args: ['--autostart'] } : {}).openAtLogin,
      autoLaunch: enabled => {
        if (!['win32', 'darwin'].includes(process.platform)) throw new Error('开机自启动支持 Windows 和 macOS。');
        if (!app.isPackaged) throw new Error('开发预览不注册开机自启动，请安装正式版后设置。');
        const options = process.platform === 'win32' ? { path: process.execPath, args: ['--autostart'] } : {};
        app.setLoginItemSettings({ ...options, openAtLogin: enabled, ...(process.platform === 'win32' ? { enabled } : {}) });
        const actual = app.getLoginItemSettings(options).openAtLogin;
        if (actual !== enabled) throw new Error('开机自启动设置未生效，请检查系统登录项或启动应用设置。');
        return actual;
      },
    });
    if (legacyMigrationFailed) service.log('warning', '旧版数据迁移未完成，原目录和凭据均已保留；未覆盖现有系统加密上下文，请在完成迁移前保留旧版应用。', false);
    if (app.isPackaged && ['win32', 'darwin'].includes(process.platform)) service.settings.autoLaunch = app.getLoginItemSettings(process.platform === 'win32' ? { path: process.execPath, args: ['--autostart'] } : {}).openAtLogin;
    if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' },
    ]));
    configureSession(); registerIpc(); createWindow();
    tray = new Tray(iconImage().resize({ width: 20, height: 20 }));
    tray.on('double-click', showWindow);
    service.on('snapshot', snapshot => {
      if (win && !win.isDestroyed()) win.webContents.send('campus:snapshot', snapshot);
      updateTray(snapshot);
      // Startup may precede campus authentication. Retry once after connecting;
      // update requests remain separate from network authentication and logs.
      if (app.isPackaged && snapshot.connection.status === 'connected' && lastConnectionStatus !== 'connected') {
        void checkUpdatesAfterConnection();
      }
      lastConnectionStatus = snapshot.connection.status;
    });
    updateTray(service.snapshot());
    networkWatcher = createNetworkWatcher({ onChange: () => { void service.onNetworkChanged().catch(() => {}); } });
    networkWatcher.start();
    tooltipTimer = setInterval(() => {
      if (!service || service.disposed || service.snapshot().connection.status !== 'connected') return;
      updateTray(service.snapshot());
    }, 30000);
    tooltipTimer?.unref?.();
    void service.initialize().catch(() => service.log('warning', '启动状态检查未完成，请点击检测网络重试。'));
    powerMonitor.on('resume', () => { void service.refreshStatus().catch(() => {}); });
  }).catch(() => {
    dialog.showErrorBox('岚连 · CDUTYB 专版启动失败', '无法初始化校园网连接工具，请重新安装或检查应用数据目录权限。');
    quitting = true; app.quit();
  });
}
