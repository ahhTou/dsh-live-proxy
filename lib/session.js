/**
 * One live proxy session: the config snapshot, the reachability probe, and the
 * serialized installer, wired so that mount, a Settings edit, and a probe
 * transition all funnel through the same reconcile step.
 *
 * The controller owns ordering; this module only decides *which* policy should
 * be installed right now.
 */
import { normalizeConfig } from './config.js';
import { createProxyController } from './controller.js';
import { effectivePolicy } from './policy.js';
import { createProbeLoop, probeProxy } from './probe.js';
import { describeError } from './util.js';

/**
 * @typedef {import('./controller.js').ProxyInstaller} ProxyInstaller
 * @typedef {import('./probe.js').Probe} Probe
 * @typedef {{ info?: (message: string) => void, warn?: (message: string) => void }} Logger
 */

/**
 * @param {object} [options]
 * @param {ProxyInstaller} [options.install] - installer override, mainly for tests.
 * @param {Probe} [options.probe] - probe override, mainly for tests.
 * @param {Logger} [options.logger]
 * @param {{ setInterval: typeof setInterval, clearInterval: typeof clearInterval }} [options.schedule]
 *   timer override, mainly for tests.
 */
export function createProxySession({ install, probe = probeProxy, logger, schedule } = {}) {
  const controller = createProxyController({
    install,
    logger,
    report: (message) => logger?.warn?.(`dsh-live-proxy: ${message}`)
  });

  /** @type {ReturnType<typeof normalizeConfig> | null} */
  let config = null;
  /** Last probe result; optimistic until the first check reports otherwise. */
  let reachable = true;
  /** @type {ReturnType<typeof createProbeLoop> | null} */
  let loop = null;
  /** Identity of the probe currently running, so a settings edit only restarts it on a real change. */
  let probeKey = '';
  let stopped = false;

  const currentPolicy = () => (config === null ? null : effectivePolicy(config, reachable));

  const reconcile = async () => {
    if (stopped || config === null) return false;
    return await controller.reconfigure(effectivePolicy(config, reachable));
  };

  /** @param {{ reachable: boolean, detail?: string }} result */
  const onProbeChange = (result) => {
    if (stopped || config === null) return;
    reachable = result.reachable !== false;
    if (reachable) {
      logger?.info?.(`dsh-live-proxy: proxy ${config.proxyUrl} is reachable again`);
    } else {
      const detail = result.detail === undefined ? '' : ` (${result.detail})`;
      logger?.warn?.(
        `dsh-live-proxy: proxy ${config.proxyUrl} is unreachable${detail}; `
          + (config.fallbackToDirect
            ? 'using a direct connection until it returns'
            : 'keeping it configured for the next probe')
      );
    }
    void reconcile().catch((error) => {
      logger?.warn?.(`dsh-live-proxy: ${describeError(error)}`);
    });
  };

  const syncProbe = () => {
    const enabled = config !== null
      && config.mode === 'manual'
      && config.proxyUrl !== ''
      && config.probeIntervalMs > 0;
    const nextKey = enabled
      ? `${config.proxyUrl}\u0000${config.probeIntervalMs}\u0000${config.probeTimeoutMs}`
      : '';
    if (nextKey === probeKey) return;

    probeKey = nextKey;
    loop?.stop();
    loop = null;
    // A new target has not been judged yet; start optimistic so the proxy is
    // tried before any fallback decision.
    reachable = true;
    if (!enabled || config === null) return;

    loop = createProbeLoop({
      proxyUrl: config.proxyUrl,
      intervalMs: config.probeIntervalMs,
      timeoutMs: config.probeTimeoutMs,
      probe,
      logger,
      schedule,
      onChange: onProbeChange
    });
    loop.start();
  };

  const status = () => ({
    config: config === null ? null : { ...config },
    reachable,
    policy: currentPolicy(),
    appliedKey: controller.appliedKey
  });

  return {
    /**
     * Apply a freshly parsed Config (raw or with volatile references).
     * @param {unknown} rawConfig
     * @returns {Promise<ReturnType<typeof status>>}
     */
    async update(rawConfig) {
      // Validate before touching any running state: a rejected edit keeps the
      // previous policy installed.
      const next = normalizeConfig(rawConfig);
      config = next;
      if (stopped) return status();
      syncProbe();
      await reconcile();
      return status();
    },

    /** Current effective state, for logs and tests. */
    status,

    /** Withdraw the policy, stop probing, and restore whatever DSH had installed. */
    async stop() {
      stopped = true;
      loop?.stop();
      loop = null;
      probeKey = '';
      await controller.close();
    }
  };
}
