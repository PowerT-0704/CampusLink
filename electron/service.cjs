'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { builtinProfiles, defaultProfile, publicProfile, validateProfile, parseProfile, profileParameters, keys } = require('./profiles.cjs');
const { runOperation } = require('./adapters.cjs');
const { CampusError } = require('./transport.cjs');

const defaults = () => ({ profileId: defaultProfile.id, username: '', rememberPassword: false, autoLaunch: false, autoConnect: false, autoReconnect: true, reconnectIntervalSeconds: 10, minimizeToTray: true, appearance: 'liquid', parameters: profileParameters(defaultProfile) });
const IDLE = (selected = false) => ({ status: 'idle', message: selected ? '准备就绪，连接校园网络后即可认证。' : '请先前往「连接方案」选择适合学校的连接方案。' });

class CampusService extends EventEmitter {
  constructor({ directory, safeStorage, version = '1.0.0', platform = process.platform, packaged = false, autoLaunch = () => false, readAutoLaunch, operation = runOperation, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, firstRun }) {
    super();
    this.directory = directory;
    this.file = path.join(directory, 'settings.json');
    this.firstRun = firstRun ?? !fs.existsSync(this.file);
    this.safeStorage = safeStorage;
    this.autoLaunch = autoLaunch;
    this.readAutoLaunch = readAutoLaunch;
    this.operation = operation;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.settings = defaults();
    this.externalProfiles = [];
    this.credential = null;
    this.memoryCredential = null;
    this.credentialMessage = '';
    this.credentialPendingSave = false;
    this.credentialRevision = 0;
    this.onboardingComplete = !this.firstRun;
    this.session = null;
    this.reconnectContext = null;
    this.reconnectPaused = false;
    this.guardResumePending = false;
    this.monitorArmed = false;
    this.monitorRunning = false;
    this.monitorTimer = null;
    this.monitorGeneration = 0;
    this.timerVersion = 0;
    this.reconnectWarning = false;
    this.disposed = false;
    this.busy = false;
    this.lastStatusCheck = 0;
    this.refreshing = false;
    this.connection = IDLE();
    this.logs = [];
    this.appInfo = { version, platform, packaged, windowGlass: false, firstRun: this.firstRun, secureStorage: this.storageAvailable() };
    this.load();
    this.connection = IDLE(Boolean(this.settings.profileId));
    this.log('info', '岚连 · CDUTYB 专版已就绪，首次连接按启动偏好执行；确认在线后可按设置检测并自动重连。', false);
  }
  storageAvailable() {
    try { return Boolean(this.safeStorage?.isEncryptionAvailable()) && this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text'; } catch { return false; }
  }
  monitoring() {
    return !this.disposed && Boolean(this.settings.profileId) && this.settings.autoReconnect && this.monitorArmed && !this.reconnectPaused;
  }
  cancelMonitorTimer() {
    this.timerVersion++;
    if (this.monitorTimer !== null) this.clearTimer(this.monitorTimer);
    this.monitorTimer = null;
  }
  stopMonitoring() {
    this.monitorGeneration++;
    this.monitorArmed = false;
    this.guardResumePending = false;
    this.cancelMonitorTimer();
  }
  armMonitoring() {
    if (this.disposed || !this.settings.profileId || !this.settings.autoReconnect || this.reconnectPaused) return;
    this.monitorArmed = true;
    if (this.session?.password && this.sameReconnectIdentity(this.session)) this.reconnectContext = { ...this.session };
    this.scheduleMonitor();
  }
  scheduleMonitor() {
    if (!this.monitoring() || this.monitorRunning || this.monitorTimer !== null) return;
    const version = ++this.timerVersion;
    this.monitorTimer = this.setTimer(() => {
      if (version !== this.timerVersion) return;
      this.monitorTimer = null;
      return this.monitorTick();
    }, this.settings.reconnectIntervalSeconds * 1000);
    this.monitorTimer?.unref?.();
  }
  sameReconnectIdentity(context) {
    return context?.profileId === this.settings.profileId && context.username === this.settings.username && JSON.stringify(context.parameters) === JSON.stringify(this.settings.parameters);
  }
  reconnectCredentials() {
    if (this.sameReconnectIdentity(this.reconnectContext) && this.reconnectContext.password) return { ...this.reconnectContext };
    if (!this.settings.rememberPassword || this.credential?.profileId !== this.settings.profileId || this.credential?.username !== this.settings.username) return null;
    try {
      const password = this.decryptPassword();
      return password ? { profileId: this.settings.profileId, username: this.settings.username, password, parameters: this.settings.parameters } : null;
    } catch { return null; }
  }
  async monitorTick() {
    if (!this.monitoring() || this.monitorRunning) return;
    if (this.busy) { this.scheduleMonitor(); return; }
    const generation = this.monitorGeneration;
    this.monitorRunning = true;
    try {
      // A timeout or unknown response remains unknown: only a positively
      // confirmed offline result permits submitting the remembered identity.
      await this.checkStatus({ silent: true });
      if (!this.monitoring() || generation !== this.monitorGeneration || this.busy || this.connection.status !== 'idle') return;
      const context = this.reconnectCredentials();
      if (!context?.username || !context.password) {
        if (!this.reconnectWarning) {
          this.reconnectWarning = true;
          this.log('warning', '检测到校园网已断开，但没有可用密码；将继续检测，请手动连接一次或保存密码以便自动重连。');
        }
        return;
      }
      this.reconnectWarning = false;
      this.log('info', '检测到校园网认证已断开，正在自动重连。', false);
      await this.connect(context, { automatic: true });
    } catch (error) {
      if (this.monitoring()) this.log('warning', this.networkError(error), true, this.errorDetails(error));
    } finally {
      this.monitorRunning = false;
      this.scheduleMonitor();
    }
  }
  dispose() {
    this.disposed = true;
    this.stopMonitoring();
    this.reconnectContext = null;
    this.memoryCredential = null;
    if (this.session) delete this.session.password;
  }
  profile(id = this.settings.profileId) {
    if (!id) throw new Error('请先前往「连接方案」选择连接方案。');
    const value = [...builtinProfiles, ...this.externalProfiles].find(p => p.id === id);
    if (!value) throw new Error('找不到连接方案，请重新选择。');
    return value;
  }
  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      if (fs.statSync(this.file).size > 1024 * 1024) throw new Error('oversized');
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.profiles) || saved.profiles.length > 30) throw new Error('version');
      this.externalProfiles = saved.profiles.map(p => validateProfile(p));
      if (new Set(this.externalProfiles.map(p => p.id)).size !== this.externalProfiles.length) throw new Error('duplicate');
      const settings = { ...defaults(), ...saved.settings };
      if (typeof settings.profileId === 'string' && ![...builtinProfiles, ...this.externalProfiles].some(profile => profile.id === settings.profileId)) {
        settings.profileId = defaultProfile.id; settings.parameters = profileParameters(defaultProfile); settings.autoConnect = false;
      }
      this.settings = this.validatedSettings(settings);
      this.onboardingComplete = saved.onboardingComplete !== false;
      this.appInfo.firstRun = !this.onboardingComplete;
      const cred = saved.credential;
      if (this.settings.rememberPassword && cred && cred.profileId === this.settings.profileId && cred.username === this.settings.username) {
        if (typeof cred.encrypted === 'string' && cred.encrypted.length > 0 && cred.encrypted.length < 20000) {
          this.credential = { profileId: cred.profileId, username: cred.username, encrypted: cred.encrypted };
          this.restoreCredentials();
        } else if (typeof cred.password === 'string' && cred.password.length > 0 && cred.password.length <= 1024 && !/[\r\n\u0000]/.test(cred.password)) {
          // Migrate only through the application's normal data path. Never copy
          // plaintext into the new persisted credential shape or a backup.
          this.memoryCredential = { profileId: cred.profileId, username: cred.username, password: cred.password };
          try {
            const prepared = this.prepareCredential(cred.profileId, cred.username, cred.password, true);
            this.commit({ credential: prepared.credential, memoryCredential: prepared.memoryCredential, settings: { ...this.settings, rememberPassword: prepared.rememberPassword, autoConnect: prepared.rememberPassword && this.settings.autoConnect } });
            if (!prepared.rememberPassword) { this.credentialPendingSave = true; this.credentialMessage = '系统加密暂不可用，旧明文已移除；密码仅在本次运行中使用，可重试加密保存。'; }
          } catch {
            this.settings = { ...this.settings, rememberPassword: false, autoConnect: false };
            this.credentialPendingSave = true;
            this.credentialMessage = '旧密码迁移未完成，原文件可能仍含明文。密码在本次运行中可用，请在密码管理中重试保存。';
          }
        }
      }
      // A locked OS vault must not erase ciphertext or the startup preference.
      // initialize() separately checks that credentials are usable.
      if (!this.credential) this.settings.autoConnect = false;
      if (this.credentialMessage) this.log('warning', this.credentialMessage, false);
      if (!this.appInfo.packaged) this.settings.autoLaunch = false;
    } catch {
      this.settings = defaults(); this.externalProfiles = []; this.credential = null; this.memoryCredential = null;
      this.log('warning', '本地配置无法读取，已使用默认设置。原文件将保留至下次保存。', false);
    }
  }
  persist({ settings = this.settings, profiles = this.externalProfiles, credential = this.credential, onboardingComplete = this.onboardingComplete } = {}) {
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    const stored = settings.rememberPassword && credential ? { profileId: credential.profileId, username: credential.username, encrypted: credential.encrypted } : null;
    if (stored && (typeof stored.encrypted !== 'string' || !stored.encrypted)) throw new Error('密码尚未加密，未保存本地配置。');
    const content = JSON.stringify({ version: 1, settings, profiles, credential: stored, onboardingComplete }, null, 2);
    try { fs.mkdirSync(this.directory, { recursive: true }); fs.writeFileSync(temp, content, { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, this.file); }
    catch { try { fs.unlinkSync(temp); } catch {} throw new Error('无法保存本地配置，请检查文件夹权限。'); }
  }
  commit({ settings = this.settings, profiles = this.externalProfiles, credential = this.credential, memoryCredential = this.memoryCredential, onboardingComplete = this.onboardingComplete } = {}) {
    this.persist({ settings, profiles, credential, onboardingComplete });
    this.settings = settings; this.externalProfiles = profiles; this.credential = credential; this.memoryCredential = memoryCredential;
    this.onboardingComplete = onboardingComplete; this.appInfo.firstRun = !onboardingComplete;
    this.credentialRevision++;
  }
  prepareCredential(profileId, username, password, rememberPassword) {
    const memoryCredential = { profileId, username, password };
    if (!rememberPassword) return { credential: null, memoryCredential, rememberPassword: false };
    if (this.credential?.profileId === profileId && this.credential.username === username && this.memoryCredential?.profileId === profileId && this.memoryCredential.username === username && this.memoryCredential.password === password) return { credential: this.credential, memoryCredential, rememberPassword: true };
    if (!this.storageAvailable()) {
      if (this.credential) throw new Error('系统加密暂不可用，原有已保存密码未更改。请稍后重试保存。');
      return { credential: null, memoryCredential, rememberPassword: false };
    }
    try {
      const encrypted = this.safeStorage.encryptString(password);
      if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > 14000 || this.safeStorage.decryptString(encrypted) !== password) throw new Error('verification');
      return { credential: { profileId, username, encrypted: encrypted.toString('base64') }, memoryCredential, rememberPassword: true };
    } catch { throw new Error('系统加密保存未完成，原有密码未更改。请重试，或取消记住密码后仅在本次运行中使用。'); }
  }
  restoreCredentials() {
    if (!this.credential) return false;
    try {
      if (!this.storageAvailable()) throw new Error('unavailable');
      const password = this.safeStorage.decryptString(Buffer.from(this.credential.encrypted, 'base64'));
      if (typeof password !== 'string' || !password || password.length > 1024 || /[\r\n\u0000]/.test(password)) throw new Error('invalid');
      this.memoryCredential = { profileId: this.credential.profileId, username: this.credential.username, password };
      this.credentialMessage = '';
      return true;
    } catch {
      this.credentialMessage = '系统暂时无法读取已保存密码，原密文已保留。请重试读取；无需立即重新输入密码。';
      return false;
    }
  }
  retryCredentials() {
    if (!this.credential) {
      if (!this.decryptPassword()) throw new Error('没有可重试的已保存或本次运行密码。');
      if (!this.storageAvailable()) throw new Error('系统加密仍暂不可用，本次密码已保留，请稍后重试。');
      return this.setCredentials({ username: this.settings.username, password: this.decryptPassword(), rememberPassword: true });
    }
    if (!this.restoreCredentials()) { this.publish(); throw new Error(this.credentialMessage); }
    return this.publish();
  }
  completeOnboarding(input) {
    keys(input, ['skip', 'username', 'password', 'rememberPassword', 'reconnectIntervalSeconds'], '首次引导');
    if (input.skip === true) {
      keys(input, ['skip'], '跳过引导');
      this.commit({ onboardingComplete: true });
      return this.publish();
    }
    if (input.skip !== undefined) throw new Error('首次引导选项无效。');
    return this.setCredentials({ username: input.username, password: input.password, rememberPassword: input.rememberPassword }, { onboardingComplete: true, reconnectIntervalSeconds: input.reconnectIntervalSeconds });
  }
  log(level, message, publish = true, details) {
    this.logs.unshift({ id: randomUUID(), time: new Date().toISOString(), level, message, ...(details ? { details } : {}) });
    this.logs = this.logs.slice(0, 100);
    if (publish) this.publish();
  }
  snapshot() {
    const available = Boolean(this.decryptPassword());
    const credentialStatus = { storage: this.credential ? 'encrypted' : available ? 'session' : 'none', available, needsRetry: Boolean((this.credential && !available) || (this.credentialPendingSave && available)), message: this.credentialMessage };
    return structuredClone({ settings: this.settings, hasPassword: Boolean(this.credential && available), credentialStatus, profiles: [...builtinProfiles.map(p => publicProfile(p, true)), ...this.externalProfiles.map(p => publicProfile(p))], connection: { ...this.connection, refreshing: this.refreshing, canDisconnect: Boolean(this.session || this.connection.status === 'connected'), monitoring: this.monitoring(), reconnectPaused: this.reconnectPaused }, logs: this.logs, app: { ...this.appInfo, secureStorage: this.storageAvailable() } });
  }
  publish() { const value = this.snapshot(); this.emit('snapshot', value); return value; }
  assertIdle() { if (this.busy) throw new Error('正在处理网络请求，请稍候。'); }
  validatedSettings(input) {
    keys(input, ['profileId', 'username', 'rememberPassword', 'autoLaunch', 'autoConnect', 'autoReconnect', 'reconnectIntervalSeconds', 'minimizeToTray', 'appearance', 'parameters'], '设置');
    if (typeof input.profileId !== 'string') throw new Error('连接方案无效。');
    const profile = input.profileId ? this.profile(input.profileId) : null;
    if (typeof input.username !== 'string' || input.username.length > 200 || /[\r\n\u0000]/.test(input.username)) throw new Error('账号格式无效。');
    for (const key of ['rememberPassword', 'autoLaunch', 'autoConnect', 'autoReconnect', 'minimizeToTray']) if (typeof input[key] !== 'boolean') throw new Error('设置值无效。');
    if (!Number.isInteger(input.reconnectIntervalSeconds) || input.reconnectIntervalSeconds < 5 || input.reconnectIntervalSeconds > 3600) throw new Error('检测间隔必须是 5 至 3600 秒的整数。');
    if (input.appearance !== 'classic' && input.appearance !== 'liquid') throw new Error('界面外观设置无效。');
    if (!profile) keys(input.parameters, [], '未选择方案时的连接参数');
    return { ...input, username: input.username.trim(), parameters: profile ? profileParameters(profile, input.parameters) : {} };
  }
  saveSettings(patch) {
    this.assertIdle();
    keys(patch, ['profileId', 'username', 'rememberPassword', 'autoLaunch', 'autoConnect', 'autoReconnect', 'reconnectIntervalSeconds', 'minimizeToTray', 'parameters'], '设置');
    const previousSettings = this.settings;
    const changedProfile = patch.profileId !== undefined && patch.profileId !== this.settings.profileId;
    if (changedProfile && (this.session || this.connection.status === 'connected')) throw new Error('请先断开当前认证，再切换连接方案。');
    const next = this.validatedSettings({ ...this.settings, ...patch, parameters: changedProfile ? (patch.parameters || {}) : (patch.parameters || this.settings.parameters) });
    const changedIdentity = next.profileId !== this.settings.profileId || next.username !== this.settings.username;
    if (changedIdentity && (this.session || this.connection.status === 'connected')) throw new Error('请先断开当前认证，再更改账号或连接方案。');
    const credential = !next.rememberPassword || changedIdentity ? null : this.credential;
    const memoryCredential = changedIdentity ? null : this.memoryCredential;
    if (!this.storageAvailable() && !credential) next.rememberPassword = false;
    if (patch.autoConnect === true && !next.profileId) throw new Error('请先前往「连接方案」选择连接方案，再启用自动连接。');
    if (patch.autoConnect === true && (!next.rememberPassword || !credential || !this.decryptPassword())) throw new Error('请先在「应用设置 → 密码管理」保存账号密码，再启用自动连接。');
    if (!next.rememberPassword || changedIdentity) next.autoConnect = false;
    if (next.autoConnect && !credential) throw new Error('请先在「应用设置 → 密码管理」保存账号密码，再启用自动连接。');
    if (next.autoConnect && this.profile(next.profileId).protocol === 'http' && !this.profile(next.profileId).operations.status) throw new Error('启用自动连接需要方案提供只读状态查询。');
    const changedAutoLaunch = next.autoLaunch !== previousSettings.autoLaunch;
    if (changedAutoLaunch) {
      try { next.autoLaunch = this.autoLaunch(next.autoLaunch); }
      catch (error) { this.refreshAutoLaunch(previousSettings); this.publish(); throw error; }
    }
    try { this.commit({ settings: next, credential, memoryCredential }); }
    catch (error) {
      if (changedAutoLaunch) {
        try {
          const restored = this.autoLaunch(previousSettings.autoLaunch);
          if (restored !== previousSettings.autoLaunch) throw new Error('rollback');
        } catch {
          this.refreshAutoLaunch({ ...previousSettings, autoLaunch: next.autoLaunch });
          this.publish();
          throw new Error('本地配置保存失败，系统自启动设置也未能恢复，请在系统启动应用中核对实际状态。');
        }
      }
      throw error;
    }
    if (changedIdentity || !next.rememberPassword) { this.credentialMessage = ''; this.credentialPendingSave = false; }
    const changedContext = changedIdentity || JSON.stringify(next.parameters) !== JSON.stringify(previousSettings.parameters);
    if (changedContext) { this.stopMonitoring(); this.reconnectContext = null; this.reconnectWarning = false; }
    if (!next.autoReconnect) this.stopMonitoring();
    if (!previousSettings.autoReconnect && next.autoReconnect && this.connection.status === 'connected' && !changedContext) {
      this.reconnectPaused = false;
      this.armMonitoring();
    }
    if (next.reconnectIntervalSeconds !== previousSettings.reconnectIntervalSeconds) { this.cancelMonitorTimer(); this.scheduleMonitor(); }
    if (changedProfile) this.connection = IDLE(Boolean(next.profileId));
    return this.publish();
  }
  setAppearance(value) {
    // 界面外观切换与网络状态无关：不受连接忙碌限制，仅持久化并广播快照。
    if (value !== 'classic' && value !== 'liquid') throw new Error('界面外观设置无效。');
    if (value === this.settings.appearance) return this.snapshot();
    this.commit({ settings: { ...this.settings, appearance: value } });
    return this.publish();
  }
  refreshAutoLaunch(fallback) {
    let actual = fallback.autoLaunch;
    try { const value = this.readAutoLaunch?.(); if (typeof value === 'boolean') actual = value; }
    catch { /* Report the failed operation even when a system state read fails. */ }
    this.settings = { ...fallback, autoLaunch: actual };
  }
  setCredentials(input, { onboardingComplete = this.onboardingComplete, reconnectIntervalSeconds = this.settings.reconnectIntervalSeconds } = {}) {
    // Saving credentials remains available while a read-only startup check runs.
    // Commit before changing any active session or reconnect context.
    keys(input, ['username', 'password', 'rememberPassword'], '账号密码');
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    if (!username || username.length > 200 || /[\r\n\u0000]/.test(username)) throw new Error('账号格式无效。');
    if (typeof input.password !== 'string' || !input.password || input.password.length > 1024 || /[\r\n\u0000]/.test(input.password)) throw new Error('密码格式无效。');
    if (input.rememberPassword !== undefined && typeof input.rememberPassword !== 'boolean') throw new Error('记住密码设置无效。');
    const changedIdentity = username !== this.settings.username;
    const prepared = this.prepareCredential(this.settings.profileId, username, input.password, input.rememberPassword ?? true);
    const settings = this.validatedSettings({ ...this.settings, username, rememberPassword: prepared.rememberPassword, reconnectIntervalSeconds, ...((changedIdentity || !prepared.rememberPassword) ? { autoConnect: false } : {}) });
    this.commit({ settings, credential: prepared.credential, memoryCredential: prepared.memoryCredential, onboardingComplete });
    this.credentialPendingSave = Boolean((input.rememberPassword ?? true) && !prepared.rememberPassword);
    this.credentialMessage = !prepared.rememberPassword && (input.rememberPassword ?? true) ? '系统加密暂不可用，密码仅在本次运行中使用；启动自动连接已关闭。' : '';
    if (changedIdentity) { this.stopMonitoring(); this.reconnectContext = null; this.reconnectWarning = false; }
    // 会话与离线上下文也同步新密码，避免后续静默检查沿用旧凭据。
    for (const context of [this.session, this.reconnectContext]) {
      if (context?.profileId === this.settings.profileId && context.username === username) context.password = input.password;
    }
    if (this.sameReconnectIdentity(this.session)) this.reconnectContext = { ...this.session };
    // 已登录时身份变化：保留当前会话，并按守护设置重新布防（手动暂停状态不受影响）。
    if (changedIdentity && this.connection.status === 'connected') this.armMonitoring();
    return this.publish();
  }
  decryptPassword() {
    // Decrypt once at startup or explicit retry, never for every UI snapshot.
    return this.memoryCredential?.profileId === this.settings.profileId && this.memoryCredential.username === this.settings.username ? this.memoryCredential.password : '';
  }
  async connect(input, { automatic = false } = {}) {
    if (this.disposed) throw new Error('应用已停止，无法继续连接。');
    this.assertIdle();
    keys(input, ['profileId', 'username', 'password', 'rememberPassword', 'parameters'], '连接请求');
    if (input.password !== undefined && (typeof input.password !== 'string' || input.password.length > 1024 || /[\r\n\u0000]/.test(input.password))) throw new Error('密码格式无效。');
    const next = this.validatedSettings({ ...this.settings, profileId: input.profileId ?? this.settings.profileId, username: input.username ?? this.settings.username, rememberPassword: input.rememberPassword ?? this.settings.rememberPassword, parameters: input.parameters ?? this.settings.parameters });
    this.profile(next.profileId);
    if (!next.username) throw new Error('请输入校园网账号。');
    if (this.session || this.connection.status === 'connected') throw new Error('当前已有认证会话，请先检查状态或断开后重试。');
    const sameIdentity = next.profileId === this.settings.profileId && next.username === this.settings.username;
    const changedContext = !sameIdentity || JSON.stringify(next.parameters) !== JSON.stringify(this.settings.parameters);
    const password = input.password || (sameIdentity ? this.decryptPassword() : '');
    if (!password) throw new Error(this.credential ? '已保存密码暂不可读取，请先重试读取已保存密码。' : '请输入校园网密码。');
    let credential = automatic ? this.credential : null;
    if (automatic && (!sameIdentity || JSON.stringify(next.parameters) !== JSON.stringify(this.settings.parameters))) throw new Error('认证身份已变化，请手动连接。');
    if (!automatic) {
      const prepared = this.prepareCredential(next.profileId, next.username, password, next.rememberPassword);
      next.rememberPassword = prepared.rememberPassword;
      if (!next.rememberPassword) next.autoConnect = false;
      this.commit({ settings: next, credential: prepared.credential, memoryCredential: prepared.memoryCredential });
      credential = prepared.credential;
      this.credentialPendingSave = Boolean(input.rememberPassword && !prepared.rememberPassword);
      this.credentialMessage = input.rememberPassword && !prepared.rememberPassword ? '系统加密暂不可用，密码仅在本次运行中使用；启动自动连接已关闭。' : '';
    }
    if (changedContext) { this.stopMonitoring(); this.reconnectContext = null; this.reconnectWarning = false; }
    this.credential = credential;
    this.settings = next;
    const credentialRevision = this.credentialRevision;
    const sessionContext = () => ({ profileId: next.profileId, username: next.username, parameters: next.parameters, ...(credentialRevision === this.credentialRevision ? { password } : this.settings.profileId === next.profileId && this.settings.username === next.username && this.decryptPassword() ? { password: this.decryptPassword() } : {}) });
    const profile = this.profile();
    const generation = this.monitorGeneration;
    // A new login attempt starts a fresh interval after it finishes. An older
    // pending timer must not query or retry immediately after that attempt.
    this.cancelMonitorTimer();
    this.busy = true;
    this.connection = { status: 'connecting', message: '正在向校园网认证服务器提交认证…' };
    this.log('info', '正在连接校园网。');
    try {
      const result = await this.operation(profile, 'login', { username: next.username, password, parameters: next.parameters });
      if (this.disposed) return this.snapshot();
      this.session = sessionContext();
      this.connection = { status: 'connected', message: result.message, ip: result.ip, portalUrl: result.portalUrl, since: new Date().toISOString() };
      if (generation === this.monitorGeneration && !this.disposed) {
        if (!automatic) this.reconnectPaused = false;
        this.reconnectContext = { ...this.session };
        this.reconnectWarning = false;
        this.armMonitoring();
      }
      this.log('success', '校园网认证成功。', false);
    } catch (error) {
      if (!this.disposed && error instanceof CampusError && error.code === 'VERIFY_FAILED') this.session = sessionContext();
      if (error instanceof CampusError && error.code === 'CAPTCHA_REQUIRED') { this.stopMonitoring(); this.reconnectContext = null; }
      this.connection = { status: 'error', message: this.networkError(error) }; this.log('error', this.connection.message, false, this.errorDetails(error));
    }
    finally { this.busy = false; this.lastStatusCheck = this.now(); this.scheduleMonitor(); }
    return this.publish();
  }
  networkError(error) { return error instanceof CampusError ? error.message : '操作未完成，请检查校园网络或打开认证页重试。'; }
  errorDetails(error) { return { code: error instanceof CampusError ? error.code : 'REQUEST_FAILED', requests: error instanceof CampusError && Array.isArray(error.diagnostics) ? error.diagnostics : [] }; }
  async disconnect() {
    // The user's intent to log out cancels reconnection immediately, even if
    // another request is busy or the logout request itself later fails.
    this.reconnectPaused = true;
    this.stopMonitoring();
    this.reconnectContext = null;
    this.publish();
    this.assertIdle();
    this.profile();
    const context = this.session || { username: this.settings.username, parameters: this.settings.parameters, profileId: this.settings.profileId };
    this.busy = true;
    this.connection = { ...this.connection, status: 'disconnecting', message: '正在退出校园网认证…' }; this.publish();
    try {
      await this.operation(this.profile(context.profileId), 'logout', context);
      this.session = null;
      this.connection = { status: 'idle', message: '已退出校园网认证。' };
      this.log('info', '已退出校园网认证。', false);
    } catch (error) { this.connection = { status: 'error', message: this.networkError(error) }; this.log('error', this.connection.message, false, this.errorDetails(error)); }
    finally { this.busy = false; }
    return this.publish();
  }
  async checkStatus({ silent = false } = {}) {
    if (this.disposed || !this.settings.profileId) return this.snapshot();
    this.assertIdle();
    const previous = this.connection;
    this.busy = true;
    this.lastStatusCheck = this.now();
    this.refreshing = true;
    if (!silent) this.connection = { ...previous, status: 'checking', message: '正在查询校园网认证状态…' };
    this.publish();
    try {
      const result = await this.operation(this.profile(), 'status', { username: this.settings.username, parameters: this.settings.parameters });
      this.connection = { status: result.online ? 'connected' : 'idle', message: result.message, ip: result.ip, portalUrl: result.portalUrl, checkedAt: new Date().toISOString(), ...(result.online && previous.since ? { since: previous.since } : {}) };
      if (!result.online) this.session = null;
      else if (!this.session) this.session = { profileId: this.settings.profileId, username: this.settings.username, parameters: this.settings.parameters };
      if (result.online) this.armMonitoring();
      if (!silent || previous.status !== this.connection.status) this.log(result.online ? 'success' : 'info', result.online ? '状态查询：当前已通过校园网认证。' : '状态查询：当前尚未认证。', false);
    } catch (error) {
      this.connection = { status: 'error', message: this.networkError(error), checkedAt: previous.checkedAt };
      if (!silent || previous.status !== 'error' || previous.message !== this.connection.message) this.log('warning', this.connection.message, false, this.errorDetails(error));
    }
    finally { this.busy = false; this.refreshing = false; }
    return this.publish();
  }
  async refreshStatus() {
    // Background reads must never race an explicit authentication action or spam logs.
    if (this.disposed || !this.settings.profileId || !this.settings.autoReconnect || this.reconnectPaused || this.busy || this.now() - this.lastStatusCheck < 5000) return this.snapshot();
    return this.checkStatus({ silent: true });
  }
  async onNetworkChanged() {
    // Called by the interface watcher when the active network changed, for
    // example because campus Wi-Fi was just joined. Unlike a focus refresh
    // this follows a real state change, so it may bypass the five second read
    // throttle; the busy guard still serializes it with explicit user actions.
    if (this.disposed || !this.settings.profileId || this.busy) return this.snapshot();
    if (this.monitoring()) return this.monitorTick();
    if (!this.settings.autoReconnect || this.reconnectPaused) return this.snapshot();
    return this.checkStatus({ silent: true });
  }
  setGuardPaused(paused) {
    // 托盘快捷开关：暂停只停止定时检测与自动重连，不注销当前会话。
    if (this.disposed) return this.snapshot();
    if (typeof paused !== 'boolean') throw new Error('守护状态无效。');
    if (paused === this.reconnectPaused) return this.snapshot();
    this.reconnectPaused = paused;
    if (paused) {
      const wasArmed = this.monitorArmed;
      this.stopMonitoring();
      this.guardResumePending = wasArmed;
    } else {
      const resume = this.guardResumePending;
      this.guardResumePending = false;
      if (this.settings.autoReconnect && (resume || this.connection.status === 'connected')) this.armMonitoring();
    }
    return this.publish();
  }
  importProfile(text) {
    this.assertIdle();
    const profile = parseProfile(text);
    if (this.externalProfiles.some(p => p.id === profile.id)) throw new Error('此方案 ID 已存在，请先移除旧方案或更改 ID。');
    if (this.externalProfiles.length >= 30) throw new Error('最多导入 30 个外部方案。');
    this.commit({ profiles: [...this.externalProfiles, profile] }); this.log('success', '外部连接方案已导入。'); return this.snapshot();
  }
  removeProfile(id) {
    this.assertIdle();
    if (builtinProfiles.some(p => p.id === id)) throw new Error('内置方案不能移除。');
    this.profile(id);
    if (this.session?.profileId === id || (this.connection.status === 'connected' && this.settings.profileId === id)) throw new Error('请先断开当前认证，再移除方案。');
    const selected = this.settings.profileId === id;
    this.commit({ profiles: this.externalProfiles.filter(p => p.id !== id), ...(selected ? { settings: { ...this.settings, profileId: defaultProfile.id, parameters: profileParameters(defaultProfile), rememberPassword: false, autoConnect: false }, credential: null, memoryCredential: null } : {}) });
    if (selected) { this.stopMonitoring(); this.reconnectContext = null; this.credentialMessage = ''; this.credentialPendingSave = false; this.connection = IDLE(); }
    this.log('info', '外部连接方案已移除。'); return this.snapshot();
  }
  clearCredentials() {
    this.assertIdle();
    this.commit({ credential: null, memoryCredential: null, settings: { ...this.settings, rememberPassword: false, autoConnect: false } });
    this.credentialMessage = '';
    this.credentialPendingSave = false;
    if (this.session) delete this.session.password;
    this.reconnectContext = null;
    this.reconnectWarning = false;
    this.log('info', '已清除保存的密码，并关闭自动连接。'); return this.snapshot();
  }
  async initialize() {
    if (this.disposed || !this.settings.profileId) return this.snapshot();
    const generation = this.monitorGeneration;
    this.log('info', '正在检查启动后的校园网认证状态。');
    const snapshot = await this.checkStatus();
    // The initial read must not authorize a later login after shutdown or a
    // manual pause canceled this startup operation while it was in flight.
    if (this.disposed || this.reconnectPaused || generation !== this.monitorGeneration) return this.snapshot();
    if (snapshot.connection.status === 'connected') return this.snapshot();
    if (snapshot.connection.status !== 'idle' || !this.settings.autoConnect || !this.settings.rememberPassword || !this.credential || !this.decryptPassword()) return this.snapshot();
    this.log('info', '当前未认证，已按设置开始自动连接。');
    return this.connect({});
  }
  async autoConnectIfEnabled() {
    if (!this.settings.profileId || !this.settings.autoConnect || !this.settings.rememberPassword || !this.credential) return this.snapshot();
    return this.initialize();
  }
}

module.exports = { CampusService, defaults };
