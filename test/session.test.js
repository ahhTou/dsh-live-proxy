import assert from 'node:assert/strict';
import test from 'node:test';
import { createProxySession } from '../lib/session.js';

/**
 * Installer that records the environment it was handed and counts disposals.
 */
function createStubInstaller() {
  /** @type {Array<Map<string, { value: string }>>} */
  const environments = [];
  let disposals = 0;
  const install = async (env) => {
    environments.push(env);
    return async () => {
      disposals += 1;
    };
  };
  return { install, environments, disposals: () => disposals };
}

/** Timer double that records scheduled callbacks without running them. */
function createFakeSchedule() {
  /** @type {Array<{ fn: () => void, intervalMs: number, cleared: boolean }>} */
  const timers = [];
  return {
    timers,
    api: {
      setInterval(fn, intervalMs) {
        const timer = { fn, intervalMs, cleared: false };
        timers.push(timer);
        return /** @type {any} */ (timer);
      },
      clearInterval(timer) {
        timer.cleared = true;
      }
    }
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

/** @param {string[]} lines */
function createLogger(lines) {
  return {
    info: (message) => lines.push(message),
    warn: (message) => lines.push(message)
  };
}

const manualConfig = {
  mode: 'manual',
  proxyUrl: 'http://127.0.0.1:7897',
  noProxy: 'example.com',
  fallbackToDirect: true,
  probeIntervalMs: 0
};

test('a manual configuration publishes the proxy policy', async () => {
  const stub = createStubInstaller();
  const lines = [];
  const session = createProxySession({ install: stub.install, logger: createLogger(lines) });
  const status = await session.update(manualConfig);

  assert.equal(status.policy.kind, 'proxy');
  assert.deepEqual([...stub.environments[0].entries()], [
    ['http_proxy', { value: 'http://127.0.0.1:7897' }],
    ['https_proxy', { value: 'http://127.0.0.1:7897' }],
    ['no_proxy', { value: 'example.com' }]
  ]);
  assert.match(lines[0], /outbound route -> proxy http:\/\/127\.0\.0\.1:7897/);
  await session.stop();
});

test('direct mode withdraws the proxy', async () => {
  const stub = createStubInstaller();
  const session = createProxySession({ install: stub.install });
  await session.update(manualConfig);
  const status = await session.update({ ...manualConfig, mode: 'direct' });

  assert.equal(status.policy.kind, 'direct');
  assert.equal(stub.environments.at(-1).size, 0);
  assert.equal(stub.disposals(), 1);
  await session.stop();
});

test('a dead proxy falls back to direct and recovers on the next probe', async () => {
  const stub = createStubInstaller();
  const lines = [];
  const timers = createFakeSchedule();
  /** @type {Array<{ reachable: boolean, detail?: string }>} */
  const probeResults = [{ reachable: false, detail: 'ECONNREFUSED' }];
  const session = createProxySession({
    install: stub.install,
    logger: createLogger(lines),
    probe: async () => probeResults.shift() ?? { reachable: false },
    schedule: timers.api
  });

  const initial = await session.update({ ...manualConfig, probeIntervalMs: 15_000 });
  // The optimistic proxy install happens first; the immediate probe may already
  // have flipped the route to direct by the time the update resolves.
  assert.equal(stub.environments[0].get('http_proxy')?.value, 'http://127.0.0.1:7897');
  assert.ok(initial.config.probeIntervalMs === 15_000);

  await settle();
  assert.equal(session.status().policy.kind, 'direct');
  assert.equal(session.status().reachable, false);
  assert.equal(stub.environments.at(-1).size, 0);
  assert.ok(lines.some((line) => /unreachable \(ECONNREFUSED\); using a direct connection/.test(line)));

  assert.equal(timers.timers.length, 1);
  probeResults.push({ reachable: true });
  timers.timers[0].fn();
  await settle();
  assert.equal(session.status().policy.kind, 'proxy');
  assert.ok(lines.some((line) => /reachable again/.test(line)));
  await session.stop();
});

test('fallbackToDirect=false keeps the proxy configured and only warns', async () => {
  const stub = createStubInstaller();
  const lines = [];
  const session = createProxySession({
    install: stub.install,
    logger: createLogger(lines),
    probe: async () => ({ reachable: false, detail: 'EHOSTUNREACH' }),
    schedule: createFakeSchedule().api
  });

  await session.update({ ...manualConfig, fallbackToDirect: false, probeIntervalMs: 15_000 });
  await settle();

  assert.equal(session.status().policy.kind, 'proxy');
  assert.ok(lines.some((line) => /keeping it configured for the next probe/.test(line)));
  await session.stop();
});

test('an invalid live edit leaves the running policy untouched', async () => {
  const stub = createStubInstaller();
  const session = createProxySession({ install: stub.install });
  await session.update(manualConfig);
  const installs = stub.environments.length;

  await assert.rejects(
    session.update({ ...manualConfig, proxyUrl: 'socks5://127.0.0.1:7897' }),
    /DSH rejects SOCKS proxies/
  );
  assert.equal(stub.environments.length, installs);
  assert.equal(session.status().config.proxyUrl, 'http://127.0.0.1:7897');
  await session.stop();
});

test('probing stops with an interval of zero or in direct mode', async () => {
  const stub = createStubInstaller();
  const timers = createFakeSchedule();
  const session = createProxySession({
    install: stub.install,
    probe: async () => ({ reachable: true }),
    schedule: timers.api
  });

  await session.update(manualConfig);
  assert.equal(timers.timers.length, 0);

  await session.update({ ...manualConfig, probeIntervalMs: 15_000 });
  assert.equal(timers.timers.length, 1);

  await session.update({ ...manualConfig, mode: 'direct', probeIntervalMs: 15_000 });
  assert.equal(timers.timers[0].cleared, true);
  await session.stop();
});

test('a URL change restarts the probe instead of trusting the old verdict', async () => {
  const stub = createStubInstaller();
  const timers = createFakeSchedule();
  /** @type {string[]} */
  const probed = [];
  let answer = { reachable: false, detail: 'ECONNREFUSED' };
  const session = createProxySession({
    install: stub.install,
    probe: async (proxyUrl) => {
      probed.push(proxyUrl);
      return answer;
    },
    schedule: timers.api
  });

  await session.update({ ...manualConfig, probeIntervalMs: 15_000 });
  await settle();
  assert.equal(session.status().policy.kind, 'direct');

  answer = { reachable: true };
  await session.update({ ...manualConfig, proxyUrl: 'http://127.0.0.1:8080', probeIntervalMs: 15_000 });
  await settle();

  assert.deepEqual(probed.slice(-1), ['http://127.0.0.1:8080']);
  assert.equal(session.status().policy.kind, 'proxy');
  assert.equal(session.status().reachable, true);
  await session.stop();
});

test('stop withdraws the policy and stops probing', async () => {
  const stub = createStubInstaller();
  const timers = createFakeSchedule();
  const session = createProxySession({
    install: stub.install,
    probe: async () => ({ reachable: true }),
    schedule: timers.api
  });

  await session.update({ ...manualConfig, probeIntervalMs: 15_000 });
  await session.stop();

  assert.equal(timers.timers[0].cleared, true);
  assert.equal(stub.disposals(), 1);

  await session.update(manualConfig);
  assert.equal(stub.environments.length, 1);
});
