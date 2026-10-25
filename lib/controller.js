/**
 * Serialized owner of the process-wide proxy installation.
 *
 * `installProxyFromEnvironment` returns an async disposer and must never be
 * called concurrently with another install or dispose: a second install before
 * the first disposer runs would leak the outer dispatcher and permanently
 * snapshot the wrong "user" environment. Every change therefore goes through
 * one chain, and identical policies are skipped.
 */
import { environmentFor, policyKey, describePolicy } from './policy.js';
import { describeError } from './util.js';

/**
 * The policy shape this module handles; `lib/policy.js` produces it.
 * @typedef {{ kind: 'direct', reason: string } | { kind: 'proxy', reason: string, proxyUrl: string, noProxy: string }} ProxyPolicy
 * @typedef {Map<string, { value: string }>} ProxyEnvironment
 * @typedef {(env: ProxyEnvironment, report: (message: string) => void) => Promise<() => Promise<void>>} ProxyInstaller
 */

/**
 * Load the DSH proxy seam.
 *
 * The import stays lazy so unit tests and non-DSH tooling can load every pure
 * module without the package being installed. Inside DSH the bare specifier is
 * resolved from the running installation (it is an installation-scoped package).
 *
 * @returns {Promise<ProxyInstaller>}
 */
export async function loadProxyInstaller() {
  const module = await import('@deepseek-ai/dsh-http-proxy');
  const install = Reflect.get(module, 'installProxyFromEnvironment');
  if (typeof install !== 'function') {
    throw new Error(
      'dsh-live-proxy: @deepseek-ai/dsh-http-proxy does not export installProxyFromEnvironment'
    );
  }
  return /** @type {ProxyInstaller} */ (install);
}

const noop = () => {};

/**
 * Create the installer wrapper.
 *
 * @param {object} [options]
 * @param {ProxyInstaller} [options.install] - installer override, mainly for tests.
 * @param {{ info?: (message: string) => void, warn?: (message: string) => void }} [options.logger]
 * @param {(message: string) => void} [options.report] - receives installer diagnostics.
 * @returns {{
 *   appliedKey: string | null,
 *   reconfigure(policy: ProxyPolicy): Promise<boolean>,
 *   close(): Promise<boolean>
 * }}
 */
export function createProxyController({ install, logger, report } = {}) {
  /** @type {ProxyInstaller | null} */
  let installer = null;
  /** @type {(() => Promise<void>) | null} */
  let dispose = null;
  /** @type {string | null} */
  let appliedKey = null;
  /** @type {Promise<unknown>} */
  let chain = Promise.resolve();
  let closed = false;

  const resolveInstaller = async () => {
    if (installer !== null) return installer;
    installer = typeof install === 'function' ? install : await loadProxyInstaller();
    return installer;
  };

  /**
   * Run one task after every earlier task, whatever its outcome.
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  const enqueue = (task) => {
    const run = chain.then(task, task);
    chain = run.then(noop, noop);
    return run;
  };

  return {
    get appliedKey() {
      return appliedKey;
    },

    /**
     * Install `policy`, withdrawing the previous one first.
     * @param {ProxyPolicy} policy
     * @returns {Promise<boolean>} whether anything changed.
     */
    reconfigure(policy) {
      return enqueue(async () => {
        if (closed) return false;
        const key = policyKey(policy);
        if (key === appliedKey) return false;

        const applyPolicy = await resolveInstaller();

        if (dispose !== null) {
          const previous = dispose;
          dispose = null;
          appliedKey = null;
          try {
            await previous();
          } catch (error) {
            logger?.warn?.(
              `dsh-live-proxy: failed to withdraw the previous policy: ${describeError(error)}`
            );
          }
        }

        try {
          dispose = await applyPolicy(environmentFor(policy), (message) => {
            report?.(message);
          });
        } catch (error) {
          logger?.warn?.(
            `dsh-live-proxy: failed to install the proxy policy: ${describeError(error)}`
          );
          throw error;
        }

        appliedKey = key;
        logger?.info?.(`dsh-live-proxy: outbound route -> ${describePolicy(policy)}`);
        return true;
      });
    },

    /**
     * Withdraw the current policy and restore the launcher's own.
     * @returns {Promise<boolean>}
     */
    close() {
      return enqueue(async () => {
        closed = true;
        if (dispose === null) return false;
        const previous = dispose;
        dispose = null;
        appliedKey = null;
        try {
          await previous();
          logger?.info?.('dsh-live-proxy: restored the previous outbound proxy policy');
        } catch (error) {
          logger?.warn?.(
            `dsh-live-proxy: failed to restore the previous policy: ${describeError(error)}`
          );
        }
        return true;
      });
    }
  };
}
