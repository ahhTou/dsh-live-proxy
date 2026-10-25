import assert from 'node:assert/strict';
import test from 'node:test';
import { describePolicy, effectivePolicy, environmentFor, policyKey } from '../lib/policy.js';

const manual = {
  mode: 'manual',
  proxyUrl: 'http://127.0.0.1:7897',
  noProxy: 'example.com',
  fallbackToDirect: true
};

test('direct mode never proxies', () => {
  const policy = effectivePolicy({ ...manual, mode: 'direct' });
  assert.deepEqual(policy, { kind: 'direct', reason: 'mode' });
});

test('manual mode proxies while the endpoint is reachable', () => {
  const policy = effectivePolicy(manual, true);
  assert.equal(policy.kind, 'proxy');
  assert.equal(policy.proxyUrl, 'http://127.0.0.1:7897');
  assert.equal(policy.noProxy, 'example.com');
});

test('manual mode without a URL explains the direct route', () => {
  const policy = effectivePolicy({ ...manual, proxyUrl: '' });
  assert.deepEqual(policy, { kind: 'direct', reason: 'no-url' });
});

test('an unreachable proxy falls back only when asked to', () => {
  assert.deepEqual(effectivePolicy(manual, false), { kind: 'direct', reason: 'unreachable' });
  assert.equal(
    effectivePolicy({ ...manual, fallbackToDirect: false }, false).kind,
    'proxy'
  );
});

test('a direct policy hands the installer an empty environment', () => {
  assert.equal(environmentFor({ kind: 'direct', reason: 'mode' }).size, 0);
});

test('a proxy policy publishes both schemes and the bypass list', () => {
  const env = environmentFor(effectivePolicy(manual, true));
  assert.deepEqual([...env.entries()], [
    ['http_proxy', { value: 'http://127.0.0.1:7897' }],
    ['https_proxy', { value: 'http://127.0.0.1:7897' }],
    ['no_proxy', { value: 'example.com' }]
  ]);
});

test('an empty bypass list is left to the installer loopback merge', () => {
  const env = environmentFor(effectivePolicy({ ...manual, noProxy: '' }, true));
  assert.equal(env.has('no_proxy'), false);
});

test('policy keys separate distinct routes and match equal ones', () => {
  assert.equal(policyKey(effectivePolicy(manual, true)), policyKey(effectivePolicy(manual, true)));
  assert.notEqual(
    policyKey(effectivePolicy(manual, true)),
    policyKey(effectivePolicy({ ...manual, noProxy: '' }, true))
  );
  assert.equal(
    policyKey({ kind: 'direct', reason: 'mode' }),
    policyKey({ kind: 'direct', reason: 'mode' })
  );
});

test('describePolicy names the route and why', () => {
  assert.equal(
    describePolicy(effectivePolicy(manual, true)),
    'proxy http://127.0.0.1:7897 (bypass: example.com)'
  );
  assert.equal(describePolicy({ kind: 'direct', reason: 'mode' }), 'direct (mode: direct)');
  assert.equal(describePolicy({ kind: 'direct', reason: 'unreachable' }), 'direct (fallback: proxy unreachable)');
  assert.equal(describePolicy({ kind: 'direct', reason: 'no-url' }), 'direct (mode: manual without proxyUrl)');
});
