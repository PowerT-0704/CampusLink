'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { CampusService, defaults } = require('../electron/service.cjs');
const { buildDiagnosticsReport } = require('../electron/diagnostics-export.cjs');
const example = require('../examples/custom-campus.example.json');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-credentials-'));
  const services = [];
  const key = randomBytes(32);
  const vault = { available: true, failDecrypt: false, failEncrypt: false, wrongRoundTrip: false, decryptions: 0 };
  const storage = {
    isEncryptionAvailable: () => vault.available,
    encryptString(value) {
      if (vault.failEncrypt) throw new Error('OS encryption failed');
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    },
    decryptString(value) {
      vault.decryptions++;
      if (vault.failDecrypt) throw new Error('OS key temporarily locked');
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      const text = Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
      return vault.wrongRoundTrip ? `${text}!` : text;
    },
  };
  function create(options = {}, Service = CampusService) {
    const service = new Service({ directory, safeStorage: storage, operation: async (_profile, action) => ({ online: action === 'login', message: 'mock' }), setTimer: () => ({ unref() {} }), clearTimer: () => {}, ...options });
    services.push(service);
    return service;
  }
  t.after(() => { for (const service of services) service.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { create, vault, storage, file: path.join(directory, 'settings.json'), directory };
}

test('remember once survives repeated restarts and startup login without another password', async t => {
  const f = fixture(t);
  const first = f.create();
  first.completeOnboarding({ username: 'fixture-account', password: '长密码&=+🤗-123', rememberPassword: true, reconnectIntervalSeconds: 10 });
  first.saveSettings({ autoConnect: true });
  const ciphertext = JSON.parse(fs.readFileSync(f.file)).credential.encrypted;
  first.dispose();
  for (let restart = 0; restart < 4; restart++) {
    const calls = [];
    const service = f.create({ operation: async (_profile, action, context) => {
      calls.push(action);
      if (action === 'login') assert.equal(context.password, '长密码&=+🤗-123');
      return { online: action === 'login', message: 'mock' };
    } });
    await service.initialize();
    assert.deepEqual(calls, ['status', 'login']);
    assert.equal(service.snapshot().app.firstRun, false);
    assert.equal(service.snapshot().credentialStatus.available, true);
    assert.equal(JSON.parse(fs.readFileSync(f.file)).credential.encrypted, ciphertext);
    const exposed = JSON.stringify(service.snapshot()) + buildDiagnosticsReport(service.snapshot());
    assert.equal(exposed.includes('长密码&=+🤗-123'), false);
    assert.equal(exposed.includes(ciphertext), false);
    service.dispose();
  }
});

test('a temporarily locked vault preserves ciphertext and startup preference across unrelated saves', async t => {
  const f = fixture(t);
  const first = f.create();
  first.setCredentials({ username: 'fixture-account', password: 'fixture-secret' });
  first.saveSettings({ autoConnect: true });
  const ciphertext = JSON.parse(fs.readFileSync(f.file)).credential.encrypted;
  f.vault.available = false;
  const calls = [];
  const locked = f.create({ operation: async (_profile, action) => { calls.push(action); return { online: false }; } });
  await locked.initialize();
  assert.deepEqual(calls, ['status']);
  assert.equal(locked.settings.autoConnect, true);
  assert.equal(locked.snapshot().credentialStatus.needsRetry, true);
  locked.setAppearance('classic');
  assert.equal(JSON.parse(fs.readFileSync(f.file)).credential.encrypted, ciphertext);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).settings.autoConnect, true);
  assert.throws(() => locked.retryCredentials(), /原密文已保留/);
  f.vault.available = true;
  locked.retryCredentials();
  const count = f.vault.decryptions;
  for (let i = 0; i < 100; i++) locked.snapshot();
  assert.equal(f.vault.decryptions, count, 'snapshots never prompt or decrypt again');
  assert.equal(locked.decryptPassword(), 'fixture-secret');
  assert.equal(locked.settings.autoConnect, true);
});

test('manual reconnect reuses durable ciphertext when the OS vault later becomes unavailable', async t => {
  const f = fixture(t);
  const service = f.create();
  service.setCredentials({ username: 'fixture-account', password: 'fixture-secret' });
  service.saveSettings({ autoConnect: true });
  const ciphertext = JSON.parse(fs.readFileSync(f.file)).credential.encrypted;
  f.vault.available = false;
  await service.connect({});
  await service.disconnect();
  await service.connect({});
  assert.equal(JSON.parse(fs.readFileSync(f.file)).credential.encrypted, ciphertext);
  assert.equal(service.settings.autoConnect, true);
  assert.throws(() => service.setCredentials({ username: 'fixture-account', password: 'replacement' }), /原有已保存密码未更改/);
  assert.equal(service.decryptPassword(), 'fixture-secret');
});

test('decryption failure can recover without replacing or re-entering the password', async t => {
  const f = fixture(t);
  const first = f.create();
  first.setCredentials({ username: 'fixture-account', password: 'fixture-secret' });
  first.saveSettings({ autoConnect: true });
  const disk = fs.readFileSync(f.file, 'utf8');
  f.vault.failDecrypt = true;
  const service = f.create();
  assert.equal(service.snapshot().credentialStatus.needsRetry, true);
  assert.equal(service.decryptPassword(), '');
  assert.throws(() => service.retryCredentials(), /原密文已保留/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), disk);
  f.vault.failDecrypt = false;
  service.retryCredentials();
  await service.initialize();
  assert.equal(service.connection.status, 'connected');
  assert.equal(service.decryptPassword(), 'fixture-secret');
});

test('encryption and round-trip verification failures never replace existing credentials', t => {
  const f = fixture(t);
  const service = f.create();
  service.setCredentials({ username: 'fixture-account', password: 'fixture-secret' });
  const before = service.snapshot();
  const disk = fs.readFileSync(f.file, 'utf8');
  for (const field of ['failEncrypt', 'wrongRoundTrip']) {
    f.vault[field] = true;
    assert.throws(() => service.setCredentials({ username: 'other-account', password: 'replacement' }), /原有密码未更改/);
    assert.deepEqual(service.snapshot(), before);
    assert.equal(fs.readFileSync(f.file, 'utf8'), disk);
    assert.equal(service.decryptPassword(), 'fixture-secret');
    f.vault[field] = false;
  }
});

test('basic_text backend is treated as unavailable and can later save the cached password', t => {
  const f = fixture(t);
  f.storage.getSelectedStorageBackend = () => 'basic_text';
  const service = f.create();
  service.setCredentials({ username: 'fixture-account', password: 'fixture-secret' });
  assert.equal(service.settings.rememberPassword, false);
  assert.equal(service.settings.autoConnect, false);
  assert.equal(service.snapshot().credentialStatus.storage, 'session');
  assert.equal(service.snapshot().credentialStatus.needsRetry, true);
  assert.equal(fs.readFileSync(f.file, 'utf8').includes('fixture-secret'), false);
  assert.throws(() => service.retryCredentials(), /仍暂不可用/);
  f.storage.getSelectedStorageBackend = () => 'gnome_libsecret';
  service.retryCredentials();
  assert.equal(service.snapshot().credentialStatus.storage, 'encrypted');
  assert.equal(f.create().decryptPassword(), 'fixture-secret');
});

function writeLegacy(f) {
  fs.writeFileSync(f.file, JSON.stringify({ version: 1, settings: { ...defaults(), username: 'legacy-account', rememberPassword: true, autoConnect: true }, profiles: [example], credential: { profileId: defaults().profileId, username: 'legacy-account', password: 'legacy-fixture-secret' } }));
}

test('legacy migration preserves choices and removes plaintext without creating another plaintext file', t => {
  const f = fixture(t);
  writeLegacy(f);
  const service = f.create();
  assert.equal(service.decryptPassword(), 'legacy-fixture-secret');
  assert.equal(service.settings.autoConnect, true);
  assert.equal(service.externalProfiles[0].id, example.id);
  assert.equal(fs.readFileSync(f.file, 'utf8').includes('legacy-fixture-secret'), false);
  assert.deepEqual(fs.readdirSync(f.directory), ['settings.json']);
  assert.equal(f.create().decryptPassword(), 'legacy-fixture-secret');
});

test('legacy migration without encryption keeps this run usable and supports retry without typing again', t => {
  const f = fixture(t);
  writeLegacy(f);
  f.vault.available = false;
  const service = f.create();
  assert.equal(service.settings.autoConnect, false);
  assert.equal(service.decryptPassword(), 'legacy-fixture-secret');
  assert.equal(JSON.parse(fs.readFileSync(f.file)).credential, null);
  assert.equal(service.snapshot().credentialStatus.needsRetry, true);
  f.vault.available = true;
  service.retryCredentials();
  assert.equal(f.create().decryptPassword(), 'legacy-fixture-secret');
});

test('failed migration retains the original file and cached password until a successful retry', t => {
  const f = fixture(t);
  writeLegacy(f);
  const disk = fs.readFileSync(f.file, 'utf8');
  class FailingMigration extends CampusService { persist() { throw new Error('disk full'); } }
  const service = f.create({}, FailingMigration);
  assert.equal(fs.readFileSync(f.file, 'utf8'), disk);
  assert.equal(service.decryptPassword(), 'legacy-fixture-secret');
  assert.match(service.snapshot().credentialStatus.message, /迁移未完成/);
  assert.equal(service.settings.autoConnect, false);
  service.persist = CampusService.prototype.persist;
  service.retryCredentials();
  assert.equal(f.create().decryptPassword(), 'legacy-fixture-secret');
});

test('write and rename failures retain disk, credentials, sessions and guard state', async t => {
  const f = fixture(t);
  const service = f.create();
  service.setCredentials({ username: 'fixture-account', password: 'fixture-secret' });
  service.importProfile(JSON.stringify(example));
  await service.connect({});
  const before = service.snapshot();
  const disk = fs.readFileSync(f.file, 'utf8');
  const session = structuredClone(service.session);
  const reconnect = structuredClone(service.reconnectContext);
  for (const method of ['writeFileSync', 'renameSync']) {
    const mocked = t.mock.method(fs, method, () => { throw new Error('simulated write failure'); });
    for (const action of [
      () => service.setCredentials({ username: 'other-account', password: 'replacement' }),
      () => service.clearCredentials(),
      () => service.setAppearance('classic'),
      () => service.saveSettings({ reconnectIntervalSeconds: 30 }),
      () => service.importProfile(JSON.stringify({ ...example, id: 'another-fixture' })),
      () => service.removeProfile(example.id),
      () => service.completeOnboarding({ skip: true }),
    ]) {
      assert.throws(action, /无法保存/);
      assert.deepEqual(service.snapshot(), before);
      assert.deepEqual(service.session, session);
      assert.deepEqual(service.reconnectContext, reconnect);
      assert.equal(fs.readFileSync(f.file, 'utf8'), disk);
    }
    mocked.mock.restore();
    assert.deepEqual(fs.readdirSync(f.directory), ['settings.json']);
  }
});

test('failed manual login persistence never changes identity or sends credentials', async t => {
  const f = fixture(t);
  let requests = 0;
  const service = f.create({ operation: async () => { requests++; return { online: true }; } });
  service.setCredentials({ username: 'fixture-account', password: 'fixture-secret' });
  const before = service.snapshot();
  t.mock.method(fs, 'renameSync', () => { throw new Error('disk full'); });
  await assert.rejects(service.connect({ username: 'different', password: 'replacement', rememberPassword: true }), /无法保存/);
  assert.equal(requests, 0);
  assert.deepEqual(service.snapshot(), before);
});

test('autostart change is rolled back when persistence fails and rollback failure is reported', t => {
  const f = fixture(t);
  let actual = false, failRollback = false;
  const service = f.create({ readAutoLaunch: () => actual, autoLaunch: enabled => { if (failRollback && !enabled) throw new Error('rollback failed'); actual = enabled; return actual; } });
  service.setCredentials({ username: 'fixture-account', password: 'fixture-secret' });
  t.mock.method(fs, 'renameSync', () => { throw new Error('disk full'); });
  assert.throws(() => service.saveSettings({ autoLaunch: true }), /无法保存/);
  assert.equal(actual, false);
  assert.equal(service.settings.autoLaunch, false);
  failRollback = true;
  assert.throws(() => service.saveSettings({ autoLaunch: true }), /未能恢复/);
  assert.equal(actual, true);
  assert.equal(service.settings.autoLaunch, true);
});

test('onboarding save is atomic, session-only is explicit, and skip survives restart', t => {
  const f = fixture(t);
  const first = f.create();
  assert.equal(first.snapshot().app.firstRun, true);
  assert.throws(() => first.completeOnboarding({ username: 'fixture-account', password: 'fixture-secret', rememberPassword: true, reconnectIntervalSeconds: 4 }), /检测间隔/);
  assert.equal(fs.existsSync(f.file), false);
  first.completeOnboarding({ username: 'fixture-account', password: 'fixture-secret', rememberPassword: false, reconnectIntervalSeconds: 15 });
  assert.equal(first.snapshot().credentialStatus.storage, 'session');
  assert.equal(first.settings.reconnectIntervalSeconds, 15);
  assert.equal(first.snapshot().app.firstRun, false);
  assert.equal(f.create().decryptPassword(), '');
  assert.equal(f.create().snapshot().app.firstRun, false);
  const skipped = fixture(t);
  skipped.create().completeOnboarding({ skip: true });
  assert.equal(skipped.create().snapshot().app.firstRun, false);
});
