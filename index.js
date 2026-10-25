/**
 * DSH Host plugin: switch the process-wide outbound proxy policy at runtime.
 *
 * DSH's launcher resolves `HTTPS_PROXY` / `HTTP_PROXY` from the environment
 * (`$DSH_HOME/.env` included) once at startup and installs the policy through
 * `@deepseek-ai/dsh-http-proxy`. Editing `.env` therefore needs a restart.
 * This plugin re-runs that same installation from its own Config, so a Settings
 * edit takes effect immediately, and a proxy that stops answering falls back
 * to a direct connection until it returns.
 *
 * Fields are `.volatile()`, so Settings -> Plugins edits rewrite the running
 * plugin's references and emit `loader/volatile-update` instead of remounting.
 */
import z from '@deepseek-ai/schemastery';
import { DEFAULT_CONFIG, MODES } from './lib/config.js';
import { createProxySession } from './lib/session.js';
import { describeError } from './lib/util.js';

export const name = 'dsh-live-proxy';

/**
 * `mode`, the proxy URL, and the probe budget are all live fields: changing any
 * of them must not restart the host.
 */
export const Config = z.object({
  mode: z.union(MODES).default(DEFAULT_CONFIG.mode).volatile(),
  proxyUrl: z.string().default(DEFAULT_CONFIG.proxyUrl).volatile(),
  noProxy: z.string().default(DEFAULT_CONFIG.noProxy).volatile(),
  fallbackToDirect: z.boolean().default(DEFAULT_CONFIG.fallbackToDirect).volatile(),
  probeIntervalMs: z
    .number()
    .step(1)
    .min(0)
    .max(600_000)
    .default(DEFAULT_CONFIG.probeIntervalMs)
    .volatile(),
  probeTimeoutMs: z
    .number()
    .step(1)
    .min(100)
    .max(60_000)
    .default(DEFAULT_CONFIG.probeTimeoutMs)
    .volatile()
});

/**
 * @param {any} ctx - Cordis plugin context.
 * @param {unknown} config - parsed Config, with live references for volatile fields.
 */
export function apply(ctx, config) {
  const session = createProxySession({ logger: ctx.logger });

  const sync = () => {
    session.update(config).catch((error) => {
      ctx.logger?.warn?.(`dsh-live-proxy: configuration rejected: ${describeError(error)}`);
    });
  };

  sync();
  ctx.on('loader/volatile-update', sync);

  ctx.effect(() => () => session.stop(), 'dsh-live-proxy');
}
