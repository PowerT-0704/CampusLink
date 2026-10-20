'use strict';

// Build from a temporary source root: Vite treats '#' in the workspace path as
// a URL fragment. Keep the existing build configuration and dependencies intact.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'campuslink-acceptance-build-'));
  try {
    fs.cpSync(path.join(root, 'src'), path.join(staging, 'src'), { recursive: true });
    fs.cpSync(path.join(root, 'assets'), path.join(staging, 'assets'), { recursive: true });
    fs.copyFileSync(path.join(root, 'index.html'), path.join(staging, 'index.html'));
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(staging, 'node_modules'), 'junction');
    const { build } = await import('vite');
    const { default: react } = await import('@vitejs/plugin-react');
    await build({ root: staging, configFile: false, base: './', plugins: [react()], resolve: { preserveSymlinks: true }, build: { outDir: path.join(staging, 'output'), sourcemap: false } });
    // A failed build never clears the last usable renderer.
    fs.cpSync(path.join(staging, 'output'), path.join(root, 'dist'), { recursive: true });
    const builtAssets = new Set(fs.readdirSync(path.join(staging, 'output', 'assets')));
    for (const name of fs.readdirSync(path.join(root, 'dist', 'assets'))) {
      if (/^index-[\w-]+\.(?:css|js)$/.test(name) && !builtAssets.has(name)) fs.unlinkSync(path.join(root, 'dist', 'assets', name));
    }
    console.log('Acceptance renderer built in dist/.');
  } finally {
    if (path.dirname(path.resolve(staging)) !== path.resolve(os.tmpdir()) || !path.basename(staging).startsWith('campuslink-acceptance-build-')) throw new Error('Unexpected staging path');
    fs.rmSync(staging, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
