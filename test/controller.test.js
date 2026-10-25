import assert from 'node:assert/strict';
import test from 'node:test';
import { createProxyController } from '../lib/controller.js';

/**
 * Installer that records the environment it was handed and counts disposals.
 * @param {{ failFirst?: boolean }} [options]
 */
function createStubInstaller({ failFirst = false } = {}) {
  /** @type {Array<Map<string, { value: string }>>} */
  const environments = [];
  let disposals = 0;
  let failed = false;
  /**
   * @param {Map<string, { value: string }>} env
   * @param {(message: string) => void} report
   */
  const install = async (env, report) => {
    if (failFirst && !failed) {
      failed = true;
      throw new Error('undici is unavailable');
    }
    environments.push(env);
    report('diagnostic from the installer');
    return async () => {
      disposals += 1;
    };
  };
  return {
    install,
    environments,
    disposals: () => disposals
  };
}

/** @param {string} proxyUrl */
const proxyPolicy = (proxyUrl) => ({ kind: 'proxy', reason: 'manual', proxyUrl, noProxy: '' });

test('installs the first policy and translates it into the installer environment', async () => {
  const stub = createStubInstaller();
  const controller = createProxyController({ install: stub.install });
  assert.equal(await controller.reconfigure(proxyPolicy('http://127.0.0.1:7897')), true);
  assert.deepEqual([...stub.environments[0].entries()], [
    ['http_proxy', { value: 'http://127.0.0.1:7897' }],
    ['https_proxy', { value: 'http://127.0.0.1:7897' }]
  ]);
  assert.equal(controller.appliedKey, 'proxy\u0000http://127.0.0.1:7897\u0000');
});

test('an unchanged policy does not touch the dispatcher', async () => {
  const stub = createStubInstaller();
  const controller = createProxyController({ install: stub.install });
  await controller.reconfigure(proxyPolicy('http://127.0.0.1:7897'));
  assert.equal(await controller.reconfigure(proxyPolicy('http://127.0.0.1:7897')), false);
  assert.equal(stub.environments.length, 1);
  assert.equal(stub.disposals(), 0);
});

test('a changed policy withdraws the previous one before installing', async () => {
  const stub = createStubInstaller();
  const controller = createProxyController({ install: stub.install });
  await controller.reconfigure(proxyPolicy('http://127.0.0.1:7897'));
  await controller.reconfigure({ kind: 'direct', reason: 'mode' });
  assert.equal(stub.disposals(), 1);
  assert.equal(stub.environments.length, 2);
  assert.equal(stub.environments[1].size, 0);
});

test('overlapping changes are serialized and the last one wins', async () => {
  const stub = createStubInstaller();
  const controller = createProxyController({ install: stub.install });
  await Promise.all([
    controller.reconfigure(proxyPolicy('http://127.0.0.1:7897')),
    controller.reconfigure({ kind: 'direct', reason: 'unreachable' }),
    controller.reconfigure(proxyPolicy('http://127.0.0.1:8080'))
  ]);
  assert.equal(stub.environments.length, 3);
  assert.equal(stub.disposals(), 2);
  assert.equal(controller.appliedKey, 'proxy\u0000http://127.0.0.1:8080\u0000');
});

test('installer diagnostics are forwarded to the report callback', async () => {
  const stub = createStubInstaller();
  /** @type {string[]} */
  const messages = [];
  const controller = createProxyController({
    install: stub.install,
    report: (message) => messages.push(message)
  });
  await controller.reconfigure(proxyPolicy('http://127.0.0.1:7897'));
  assert.deepEqual(messages, ['diagnostic from the installer']);
});

test('a failed install leaves no applied policy and can be retried', async () => {
  const stub = createStubInstaller({ failFirst: true });
  /** @type {string[]} */
  const warnings = [];
  const controller = createProxyController({
    install: stub.install,
    logger: { warn: (message) => warnings.push(message) }
  });
  await assert.rejects(controller.reconfigure(proxyPolicy('http://127.0.0.1:7897')), /undici is unavailable/);
  assert.equal(controller.appliedKey, null);
  assert.match(warnings[0], /failed to install the proxy policy/);
  assert.equal(await controller.reconfigure(proxyPolicy('http://127.0.0.1:7897')), true);
  assert.equal(stub.environments.length, 1);
});

test('close withdraws the policy and blocks later installs', async () => {
  const stub = createStubInstaller();
  const controller = createProxyController({ install: stub.install });
  await controller.reconfigure(proxyPolicy('http://127.0.0.1:7897'));
  assert.equal(await controller.close(), true);
  assert.equal(stub.disposals(), 1);
  assert.equal(controller.appliedKey, null);
  assert.equal(await controller.reconfigure(proxyPolicy('http://127.0.0.1:8080')), false);
  assert.equal(stub.environments.length, 1);
});
