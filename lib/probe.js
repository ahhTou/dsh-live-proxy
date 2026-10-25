/**
 * Proxy reachability probing.
 *
 * The probe opens a TCP connection to the proxy endpoint. That answers the
 * question this plugin needs — "is the local proxy still listening?" — without
 * sending traffic anywhere, without a target URL that could leak, and without
 * the latency of a full round trip through the proxy.
 *
 * It deliberately does not claim anything about upstream connectivity: a proxy
 * that accepts connections but cannot reach the internet still counts as up.
 */
import net from 'node:net';
import { describeError } from './util.js';

/** @typedef {{ reachable: boolean, detail?: string }} ProbeResult */
/** @typedef {(proxyUrl: string, timeoutMs: number) => Promise<ProbeResult>} Probe */

/**
 * Split a proxy URL into the endpoint to connect to.
 * @param {string} proxyUrl
 * @returns {{ host: string, port: number }}
 */
export function parseProxyEndpoint(proxyUrl) {
  const url = new URL(proxyUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`unsupported proxy scheme ${url.protocol}//`);
  }
  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === '') throw new Error('proxy URL has no host');
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`proxy URL has an invalid port: ${url.port}`);
  }
  return { host, port };
}

/**
 * Check whether the proxy endpoint accepts a TCP connection.
 * Never rejects: a probe failure is data, not an exception.
 *
 * @param {string} proxyUrl
 * @param {number} [timeoutMs]
 * @returns {Promise<ProbeResult>}
 */
export function probeProxy(proxyUrl, timeoutMs = 2_000) {
  /** @type {{ host: string, port: number }} */
  let endpoint;
  try {
    endpoint = parseProxyEndpoint(proxyUrl);
  } catch (error) {
    return Promise.resolve({ reachable: false, detail: describeError(error) });
  }

  return new Promise((resolve) => {
    let settled = false;
    const socket = net.connect({ host: endpoint.host, port: endpoint.port });
    /** @param {ProbeResult} result */
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ reachable: true }));
    socket.once('timeout', () =>
      finish({ reachable: false, detail: `no answer within ${timeoutMs} ms` })
    );
    socket.once('error', (error) => finish({ reachable: false, detail: describeError(error) }));
  });
}

/**
 * Repeat `probe` while the policy stays on this proxy.
 *
 * The first check runs immediately, so a proxy that died while DSH was closed
 * is discovered at mount instead of one interval later. `onChange` fires only
 * when reachability flips; the initial optimistic state is `reachable`.
 *
 * @param {object} options
 * @param {string} options.proxyUrl
 * @param {number} options.intervalMs - 0 disables repetition (the first check still runs).
 * @param {number} options.timeoutMs
 * @param {Probe} [options.probe]
 * @param {(result: ProbeResult) => void} [options.onChange]
 * @param {{ warn?: (message: string) => void }} [options.logger]
 * @param {{ setInterval: typeof setInterval, clearInterval: typeof clearInterval }} [options.schedule]
 *   timer override, mainly for tests.
 * @returns {{
 *   reachable: boolean,
 *   check(): Promise<void>,
 *   start(): void,
 *   stop(): void
 * }}
 */
export function createProbeLoop({
  proxyUrl,
  intervalMs,
  timeoutMs,
  probe = probeProxy,
  onChange,
  logger,
  schedule = { setInterval, clearInterval }
}) {
  let reachable = true;
  let checking = false;
  let active = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;

  const check = async () => {
    if (!active || checking) return;
    checking = true;
    try {
      const result = await probe(proxyUrl, timeoutMs);
      if (!active) return;
      const next = result.reachable !== false;
      if (next === reachable) return;
      reachable = next;
      onChange?.(result);
    } catch (error) {
      if (active) {
        logger?.warn?.(`dsh-live-proxy: proxy probe failed: ${describeError(error)}`);
      }
    } finally {
      checking = false;
    }
  };

  return {
    get reachable() {
      return reachable;
    },
    check,
    start() {
      if (active) return;
      active = true;
      void check();
      if (intervalMs > 0) {
        timer = schedule.setInterval(() => {
          void check();
        }, intervalMs);
        // A reachability check must never be the reason the process stays alive.
        if (typeof timer === 'object' && timer !== null) Reflect.get(timer, 'unref')?.call(timer);
      }
    },
    stop() {
      active = false;
      if (timer !== null) {
        schedule.clearInterval(timer);
        timer = null;
      }
    }
  };
}
