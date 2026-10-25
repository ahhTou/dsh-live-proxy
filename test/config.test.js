import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONFIG, MODES, normalizeConfig, normalizeProxyUrl, readConfig } from '../lib/config.js';

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

/**
 * A live reference shaped like the ones Cordis hands a plugin for volatile fields.
 * @param {unknown} value
 */
function volatileRef(value) {
  return Object.freeze({ get: () => value, [VOLATILE_WRITE]: () => {} });
}

test('defaults describe an inert plugin', () => {
  const config = normalizeConfig({});
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(config.mode, 'direct');
  assert.deepEqual(MODES, ['direct', 'manual']);
});

test('readConfig resolves every volatile reference', () => {
  const raw = {
    mode: volatileRef('manual'),
    proxyUrl: volatileRef('http://127.0.0.1:7897'),
    noProxy: 'example.com',
    probeIntervalMs: volatileRef(0)
  };
  assert.deepEqual(readConfig(raw), {
    mode: 'manual',
    proxyUrl: 'http://127.0.0.1:7897',
    noProxy: 'example.com',
    probeIntervalMs: 0
  });
});

test('normalizeConfig accepts a volatile Config object', () => {
  const config = normalizeConfig({
    mode: volatileRef('manual'),
    proxyUrl: volatileRef('http://127.0.0.1:7897')
  });
  assert.equal(config.mode, 'manual');
  assert.equal(config.proxyUrl, 'http://127.0.0.1:7897');
});

test('normalizeConfig rejects an unknown mode', () => {
  assert.throws(() => normalizeConfig({ mode: 'system' }), /"mode" must be one of direct, manual/);
});

test('a bare host:port gains the http scheme', () => {
  assert.equal(normalizeProxyUrl('127.0.0.1:7897'), 'http://127.0.0.1:7897');
  assert.equal(normalizeProxyUrl('  proxy.lan:3128 '), 'http://proxy.lan:3128');
});

test('SOCKS is refused with an actionable message', () => {
  assert.throws(() => normalizeProxyUrl('socks5://127.0.0.1:7897'), /DSH rejects SOCKS proxies/);
  assert.throws(() => normalizeProxyUrl('socks5h://127.0.0.1:7897'), /DSH rejects SOCKS proxies/);
});

test('unsupported schemes, query strings, and fragments are refused', () => {
  assert.throws(() => normalizeProxyUrl('ftp://127.0.0.1:21'), /unsupported ftp:\/\/ scheme/);
  assert.throws(() => normalizeProxyUrl('http://127.0.0.1:7897/?x=1'), /query or fragment/);
  assert.throws(() => normalizeProxyUrl('http://127.0.0.1:7897/#x'), /query or fragment/);
});

test('an empty proxy URL stays empty so manual mode can explain itself', () => {
  assert.equal(normalizeProxyUrl('   '), '');
});

test('a bypass list is normalized around its separators', () => {
  const config = normalizeConfig({ noProxy: ' example.com , api.example.com ,, .local ' });
  assert.equal(config.noProxy, 'example.com,api.example.com,.local');
});

test('the probe budget is validated', () => {
  assert.throws(() => normalizeConfig({ probeIntervalMs: -1 }), /"probeIntervalMs"/);
  assert.throws(() => normalizeConfig({ probeIntervalMs: 1.5 }), /"probeIntervalMs"/);
  assert.throws(() => normalizeConfig({ probeIntervalMs: 600_001 }), /"probeIntervalMs"/);
  assert.throws(() => normalizeConfig({ probeTimeoutMs: 0 }), /"probeTimeoutMs"/);
  assert.throws(() => normalizeConfig({ probeTimeoutMs: 60_001 }), /"probeTimeoutMs"/);
});

test('boolean fields are validated', () => {
  assert.throws(() => normalizeConfig({ fallbackToDirect: 'yes' }), /"fallbackToDirect"/);
});
