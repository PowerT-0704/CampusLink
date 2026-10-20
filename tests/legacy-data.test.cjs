'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrateLegacyData } = require('../electron/legacy-data.cjs');

function fixture(t, encrypted = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-legacy-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDirectory = path.join(root, 'old'), targetDirectory = path.join(root, 'new');
  fs.mkdirSync(sourceDirectory);
  const source = JSON.stringify({ version: 1, profiles: [], settings: { username: 'fixture-account' }, credential: encrypted ? { encrypted: 'synthetic-ciphertext' } : { password: 'fixture-secret' } });
  const context = JSON.stringify({ os_crypt: { encrypted_key: 'synthetic-protected-context' } });
  fs.writeFileSync(path.join(sourceDirectory, 'settings.json'), source);
  fs.writeFileSync(path.join(sourceDirectory, 'Local State'), context);
  return { sourceDirectory, targetDirectory, source, context, platform: 'win32' };
}

test('legacy encrypted migration carries the Windows context and preserves originals', t => {
  const f = fixture(t);
  assert.equal(migrateLegacyData(f), true);
  for (const [name, content] of [['settings.json', f.source], ['Local State', f.context]]) {
    assert.equal(fs.readFileSync(path.join(f.targetDirectory, name), 'utf8'), content);
    assert.equal(fs.readFileSync(path.join(f.sourceDirectory, name), 'utf8'), content);
  }
  assert.deepEqual(fs.readdirSync(f.targetDirectory).sort(), ['Local State', 'settings.json']);
  assert.equal(migrateLegacyData(f), false);
});

test('migration never overwrites an existing settings file or a different encryption context', t => {
  const f = fixture(t);
  fs.mkdirSync(f.targetDirectory);
  const state = '{"os_crypt":{"encrypted_key":"different-existing-context"}}';
  fs.writeFileSync(path.join(f.targetDirectory, 'Local State'), state);
  assert.throws(() => migrateLegacyData(f), /must be preserved/);
  assert.equal(fs.existsSync(path.join(f.targetDirectory, 'settings.json')), false);
  assert.equal(fs.readFileSync(path.join(f.targetDirectory, 'Local State'), 'utf8'), state);
  fs.writeFileSync(path.join(f.targetDirectory, 'settings.json'), 'existing-settings');
  assert.equal(migrateLegacyData(f), false);
  assert.equal(fs.readFileSync(path.join(f.targetDirectory, 'settings.json'), 'utf8'), 'existing-settings');
});

test('plaintext migration does not copy any encryption context', t => {
  const f = fixture(t, false);
  assert.equal(migrateLegacyData(f), true);
  assert.deepEqual(fs.readdirSync(f.targetDirectory), ['settings.json']);
});

test('an interrupted migration with the same encryption context can safely finish', t => {
  const f = fixture(t);
  fs.mkdirSync(f.targetDirectory);
  fs.writeFileSync(path.join(f.targetDirectory, 'Local State'), f.context);
  assert.equal(migrateLegacyData(f), true);
  assert.equal(fs.readFileSync(path.join(f.targetDirectory, 'settings.json'), 'utf8'), f.source);
});

test('failed publication leaves no partially written settings and preserves the old data', t => {
  const f = fixture(t, false);
  t.mock.method(fs, 'linkSync', () => { throw new Error('publication failed'); });
  assert.throws(() => migrateLegacyData(f), /publication failed/);
  assert.deepEqual(fs.readdirSync(f.targetDirectory), []);
  assert.equal(fs.readFileSync(path.join(f.sourceDirectory, 'settings.json'), 'utf8'), f.source);
});
