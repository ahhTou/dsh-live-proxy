/**
 * Proxy policy selection: the pure decision of whether this process reaches the
 * network directly or through the configured proxy, plus the environment DSH's
 * installer needs to publish that decision.
 *
 * `@deepseek-ai/dsh-http-proxy` reads only environment-shaped input, so the
 * policy is turned into a `Map` here and handed to `installProxyFromEnvironment`.
 */

/**
 * @typedef {{ kind: 'direct', reason: 'mode' | 'no-url' | 'unreachable' }} DirectPolicy
 * @typedef {{ kind: 'proxy', reason: 'manual', proxyUrl: string, noProxy: string }} ProxyPolicy
 * @typedef {DirectPolicy | ProxyPolicy} ProxyPolicyChoice
 */

/**
 * Decide the effective policy.
 *
 * `reachable` is the last probe result and only matters when the proxy is
 * configured with `fallbackToDirect`; an unknown or optimistic state counts as
 * reachable so a fresh start attempts the proxy first.
 *
 * @param {{ mode: 'direct' | 'manual', proxyUrl: string, noProxy: string, fallbackToDirect: boolean }} config
 * @param {boolean} [reachable]
 * @returns {ProxyPolicyChoice}
 */
export function effectivePolicy(config, reachable = true) {
  if (config.mode === 'direct') return { kind: 'direct', reason: 'mode' };
  if (config.proxyUrl === '') return { kind: 'direct', reason: 'no-url' };
  if (config.fallbackToDirect && reachable === false) return { kind: 'direct', reason: 'unreachable' };
  return {
    kind: 'proxy',
    reason: 'manual',
    proxyUrl: config.proxyUrl,
    noProxy: config.noProxy
  };
}

/**
 * Build the environment map `installProxyFromEnvironment` consumes.
 *
 * Only the lowercase names are written: the installer prefers them, mirrors
 * both casings into the process environment, and merges the loopback bypass
 * entries itself. A direct policy is the empty map, which the installer
 * resolves to a direct dispatcher.
 *
 * @param {ProxyPolicyChoice} policy
 * @returns {Map<string, { value: string }>}
 */
export function environmentFor(policy) {
  const env = new Map();
  if (policy.kind !== 'proxy') return env;
  env.set('http_proxy', { value: policy.proxyUrl });
  env.set('https_proxy', { value: policy.proxyUrl });
  if (policy.noProxy !== '') env.set('no_proxy', { value: policy.noProxy });
  return env;
}

/**
 * Stable identity for one policy, used to skip no-op reinstalls.
 * @param {ProxyPolicyChoice} policy
 * @returns {string}
 */
export function policyKey(policy) {
  if (policy.kind === 'direct') return `direct:${policy.reason}`;
  return `proxy\u0000${policy.proxyUrl}\u0000${policy.noProxy}`;
}

/**
 * One-line description for logs and status output.
 * @param {ProxyPolicyChoice} policy
 * @returns {string}
 */
export function describePolicy(policy) {
  if (policy.kind === 'proxy') {
    const bypass = policy.noProxy === '' ? '' : ` (bypass: ${policy.noProxy})`;
    return `proxy ${policy.proxyUrl}${bypass}`;
  }
  switch (policy.reason) {
    case 'mode':
      return 'direct (mode: direct)';
    case 'no-url':
      return 'direct (mode: manual without proxyUrl)';
    case 'unreachable':
      return 'direct (fallback: proxy unreachable)';
    default:
      return 'direct';
  }
}
