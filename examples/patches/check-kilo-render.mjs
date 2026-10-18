import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// Execute the real bundles in a separate, offline browser, never in live chats.
export async function checkRender(directories) {
  const require = createRequire(process.env.KILO_BROWSER_RUNTIME || path.join(os.homedir(), '.config/shared-computer/runtime/package.json'));
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const directory of directories) for (const name of ['webview', 'agent-manager']) {
      const bundle = path.join(directory, name + '.js');
      assert(fs.existsSync(bundle), `Missing ${name} bundle`);
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // localhost is a secure context (crypto.randomUUID); every request is intercepted.
      await page.route('**/*', route => route.fulfill({ status: 200, body: '' }));
      await page.goto('http://localhost:41739/');
      await page.setContent('<html><body><div id="root"></div></body></html>');
      await page.evaluate(() => {
        let state = {};
        window.acquireVsCodeApi = () => ({
          getState: () => state, setState: next => (state = next), postMessage() {},
        });
        window.ICONS_BASE_URI = 'data:,';
      });
      const css = path.join(directory, name + '.css');
      if (fs.existsSync(css)) await page.addStyleTag({ path: css });
      await page.addScriptTag({ path: bundle });
      await page.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0, undefined, { timeout: 5000 });
      await page.waitForTimeout(400);
      assert.deepEqual(errors, [], `${name}: runtime errors`);
      assert(await page.locator('#root').isVisible(), `${name}: root is hidden`);
      assert(await page.locator('#root button, #root textarea, #root input, #root [contenteditable=true]').count() > 0,
        `${name}: no usable controls rendered`);
      console.log(`PASS ${name}: renders visible controls without runtime errors`);
      await page.close();
    }
  } finally { await browser.close(); }
}
