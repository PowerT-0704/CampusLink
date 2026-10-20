'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function readBounded(file, limit) {
  if (fs.statSync(file).size > limit) throw new Error('Legacy application data is oversized');
  return fs.readFileSync(file);
}

function publishCopy(file, content) {
  const temporary = `${file}.${randomUUID()}.migration.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    fs.linkSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* Keep the original migration failure. */ }
  }
}

function migrateLegacyData({ sourceDirectory, targetDirectory, platform = process.platform }) {
  const source = path.resolve(sourceDirectory), target = path.resolve(targetDirectory);
  const sourceSettings = path.join(source, 'settings.json'), targetSettings = path.join(target, 'settings.json');
  if (source === target || fs.existsSync(targetSettings) || !fs.existsSync(sourceSettings)) return false;
  const settings = readBounded(sourceSettings, 1024 * 1024);
  const saved = JSON.parse(settings.toString('utf8'));
  if (saved.version !== 1 || !Array.isArray(saved.profiles)) throw new Error('Unsupported legacy application data');
  const sourceState = path.join(source, 'Local State'), targetState = path.join(target, 'Local State');
  // Windows ciphertext depends on the app's OS-protected Chromium context.
  // Carry that opaque context before Electron is ready; never overwrite a
  // different existing context, expose it to the renderer, or remove originals.
  if (platform === 'win32' && typeof saved.credential?.encrypted === 'string' && fs.existsSync(sourceState)) {
    const state = readBounded(sourceState, 4 * 1024 * 1024);
    const sourceCrypto = JSON.parse(state.toString('utf8')).os_crypt;
    if (!sourceCrypto || typeof sourceCrypto !== 'object') throw new Error('Missing legacy encryption context');
    if (fs.existsSync(targetState)) {
      const targetCrypto = JSON.parse(readBounded(targetState, 4 * 1024 * 1024).toString('utf8')).os_crypt;
      if (JSON.stringify(sourceCrypto) !== JSON.stringify(targetCrypto)) throw new Error('Existing encryption context must be preserved');
    } else {
      publishCopy(targetState, state);
    }
  }
  publishCopy(targetSettings, settings);
  return true;
}

module.exports = { migrateLegacyData };
