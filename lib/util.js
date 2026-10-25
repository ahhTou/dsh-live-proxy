/** Small dependency-free helpers shared by the proxy policy, probe, and installer. */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Render any thrown value as one log line.
 * @param {unknown} error
 * @returns {string}
 */
export function describeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Shared reference protocol used by `@deepseek-ai/cosmokit`, which Cordis uses
 * to hand a running plugin the live value behind a `.volatile()` Config field.
 * The symbol is global, so this stays a dependency-free duck type.
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

/**
 * Whether a Config value is a live reference rather than a plain value.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isVolatileRef(value) {
  return typeof value === 'object' && value !== null && VOLATILE_WRITE in value;
}

/**
 * Read the current value behind a live reference, or the value itself.
 * @param {unknown} value
 * @returns {unknown}
 */
export function readValue(value) {
  return isVolatileRef(value) ? /** @type {{ get(): unknown }} */ (value).get() : value;
}
