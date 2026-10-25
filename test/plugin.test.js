import assert from 'node:assert/strict';
import test from 'node:test';

test('index.js exposes the Cordis plugin face', async (t) => {
  /** @type {any} */
  let module;
  try {
    module = await import('../index.js');
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 'ERR_MODULE_NOT_FOUND') {
      t.skip('@deepseek-ai/schemastery is provided by the DSH installation, not by this checkout');
      return;
    }
    throw error;
  }

  assert.equal(module.name, 'dsh-live-proxy');
  assert.equal(typeof module.apply, 'function');
  assert.ok(module.Config, 'Config schema must be exported for the Settings form');
});
