/**
 * Config normalization for the live proxy plugin.
 *
 * The Cordis Config schema in `index.js` already rejects wrong field types, so
 * this module only applies the cross-field rules a schema cannot express:
 * which modes exist, which proxy URLs DSH accepts, and the probe budget.
 * Keeping it schema-free also keeps it unit-testable outside the DSH process.
 */
import { readValue } from './util.js';

/** Modes this plugin understands. `system` (macOS `scutil --proxy`) comes later. */
export const MODES = ['direct', 'manual'];

/** Shipped defaults. `direct` means an installed plugin changes nothing until configured. */
export const DEFAULT_CONFIG = Object.freeze({
  mode: 'direct',
  proxyUrl: 'http://127.0.0.1:7897',
  noProxy: '',
  fallbackToDirect: true,
  probeIntervalMs: 15_000,
  probeTimeoutMs: 2_000
});

const MAX_PROBE_INTERVAL_MS = 10 * 60_000;
const MIN_PROBE_TIMEOUT_MS = 100;
const MAX_PROBE_TIMEOUT_MS = 60_000;
const SOCKS_PROTOCOLS = new Set(['socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:']);

/**
 * Flatten a parsed Config, resolving every volatile reference to its live value.
 * @param {unknown} config - the Config object Cordis hands to `apply`, or a plain object.
 * @returns {Record<string, unknown>}
 */
export function readConfig(config) {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return {};
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, readValue(value)])
  );
}

/**
 * Validate a parsed Config and fill in defaults.
 * @param {unknown} config
 * @returns {{ mode: 'direct' | 'manual', proxyUrl: string, noProxy: string, fallbackToDirect: boolean, probeIntervalMs: number, probeTimeoutMs: number }}
 * @throws when a field is not one this plugin can act on.
 */
export function normalizeConfig(config) {
  const raw = readConfig(config);

  const mode = raw.mode ?? DEFAULT_CONFIG.mode;
  if (typeof mode !== 'string' || !MODES.includes(/** @type {any} */ (mode))) {
    throw new Error(`dsh-live-proxy: "mode" must be one of ${MODES.join(', ')}`);
  }

  const proxyUrl = normalizeProxyUrl(raw.proxyUrl ?? DEFAULT_CONFIG.proxyUrl);

  const rawNoProxy = raw.noProxy ?? DEFAULT_CONFIG.noProxy;
  if (typeof rawNoProxy !== 'string') {
    throw new Error('dsh-live-proxy: "noProxy" must be a string of comma-separated hosts');
  }

  const fallbackToDirect = raw.fallbackToDirect ?? DEFAULT_CONFIG.fallbackToDirect;
  if (typeof fallbackToDirect !== 'boolean') {
    throw new Error('dsh-live-proxy: "fallbackToDirect" must be a boolean');
  }

  const probeIntervalMs = normalizeInteger(
    raw.probeIntervalMs ?? DEFAULT_CONFIG.probeIntervalMs,
    'probeIntervalMs',
    0,
    MAX_PROBE_INTERVAL_MS
  );
  const probeTimeoutMs = normalizeInteger(
    raw.probeTimeoutMs ?? DEFAULT_CONFIG.probeTimeoutMs,
    'probeTimeoutMs',
    MIN_PROBE_TIMEOUT_MS,
    MAX_PROBE_TIMEOUT_MS
  );

  return {
    mode: /** @type {'direct' | 'manual'} */ (mode),
    proxyUrl,
    noProxy: normalizeNoProxy(rawNoProxy),
    fallbackToDirect,
    probeIntervalMs,
    probeTimeoutMs
  };
}

/**
 * Normalize one proxy URL.
 *
 * A bare `host:port` gains `http://` so the settings field accepts what people
 * copy out of their proxy application. DSH itself only tunnels `http:` and
 * `https:`, so a SOCKS value is refused here with an actionable message rather
 * than being silently ignored later by `installProxyFromEnvironment`.
 *
 * @param {unknown} value
 * @returns {string} the trimmed URL, or `''` when unset.
 */
export function normalizeProxyUrl(value) {
  if (typeof value !== 'string') {
    throw new Error('dsh-live-proxy: "proxyUrl" must be a string');
  }
  let text = value.trim();
  if (text === '') return '';
  if (!text.includes('://')) text = `http://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`dsh-live-proxy: "proxyUrl" is not a valid URL: ${text}`);
  }
  if (SOCKS_PROTOCOLS.has(url.protocol)) {
    throw new Error(
      'dsh-live-proxy: "proxyUrl" must use http:// or https://; DSH rejects SOCKS proxies, '
        + 'so point it at the HTTP port your proxy software listens on'
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `dsh-live-proxy: "proxyUrl" uses the unsupported ${url.protocol}// scheme; use http:// or https://`
    );
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('dsh-live-proxy: "proxyUrl" must not carry a query or fragment');
  }
  return text;
}

/**
 * Collapse whitespace around the separators of a bypass list.
 * @param {string} value
 * @returns {string}
 */
function normalizeNoProxy(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .join(',');
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function normalizeInteger(value, field, min, max) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`dsh-live-proxy: "${field}" must be an integer between ${min} and ${max}`);
  }
  return value;
}
