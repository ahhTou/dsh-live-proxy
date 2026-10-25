import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { createProbeLoop, parseProxyEndpoint, probeProxy } from '../lib/probe.js';

/** @param {import('node:net').Server} server */
async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP address');
  return address.port;
}

/** @param {() => boolean} predicate */
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('condition never became true');
}

function fakeSchedule() {
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

test('parseProxyEndpoint reads host and port, including defaults and IPv6', () => {
  assert.deepEqual(parseProxyEndpoint('http://127.0.0.1:7897'), { host: '127.0.0.1', port: 7897 });
  assert.deepEqual(parseProxyEndpoint('http://proxy.lan'), { host: 'proxy.lan', port: 80 });
  assert.deepEqual(parseProxyEndpoint('https://proxy.lan'), { host: 'proxy.lan', port: 443 });
  assert.deepEqual(parseProxyEndpoint('http://[::1]:3128'), { host: '::1', port: 3128 });
});

test('parseProxyEndpoint refuses unsupported schemes', () => {
  assert.throws(() => parseProxyEndpoint('socks5://127.0.0.1:7897'), /unsupported proxy scheme/);
});

test('probeProxy reports a listening endpoint as reachable', async () => {
  const server = net.createServer((socket) => socket.destroy());
  const port = await listen(server);
  try {
    assert.deepEqual(await probeProxy(`http://127.0.0.1:${port}`, 1_000), { reachable: true });
  } finally {
    server.close();
  }
});

test('probeProxy reports a closed port as unreachable with a reason', async () => {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  const result = await probeProxy(`http://127.0.0.1:${port}`, 1_000);
  assert.equal(result.reachable, false);
  assert.ok(result.detail);
});

test('probeProxy never rejects for an unusable proxy URL', async () => {
  const result = await probeProxy('not a url', 100);
  assert.equal(result.reachable, false);
});

test('the probe loop starts immediately and only reports transitions', async () => {
  const results = [{ reachable: false, detail: 'ECONNREFUSED' }];
  /** @type {Array<{ reachable: boolean }>} */
  const changes = [];
  const timers = fakeSchedule();
  const loop = createProbeLoop({
    proxyUrl: 'http://127.0.0.1:7897',
    intervalMs: 15_000,
    timeoutMs: 1_000,
    probe: async () => results.shift() ?? { reachable: false },
    onChange: (result) => changes.push(result),
    schedule: timers.api
  });

  loop.start();
  await waitFor(() => changes.length === 1);
  assert.deepEqual(changes, [{ reachable: false, detail: 'ECONNREFUSED' }]);
  assert.equal(timers.timers.length, 1);
  assert.equal(timers.timers[0].intervalMs, 15_000);

  // A repeat of the same answer is not a transition.
  timers.timers[0].fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(changes.length, 1);

  // Recovery is.
  results.push({ reachable: true });
  timers.timers[0].fn();
  await waitFor(() => changes.length === 2);
  assert.equal(changes[1].reachable, true);
  assert.equal(loop.reachable, true);

  loop.stop();
  assert.equal(timers.timers[0].cleared, true);
});

test('an interval of zero probes once and never schedules', async () => {
  const timers = fakeSchedule();
  let calls = 0;
  const loop = createProbeLoop({
    proxyUrl: 'http://127.0.0.1:7897',
    intervalMs: 0,
    timeoutMs: 1_000,
    probe: async () => {
      calls += 1;
      return { reachable: true };
    },
    schedule: timers.api
  });
  loop.start();
  await waitFor(() => calls === 1);
  assert.equal(timers.timers.length, 0);
  loop.stop();
});
