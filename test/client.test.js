/**
 * Contract tests for the browser half.
 *
 * `lib/client.js` is a plain module-loader factory, so it can be executed in a
 * VM without a browser: the tests assert the registration the Plugins page
 * needs and that its ids stay in sync with the package and the row.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'));
const patch = readFileSync(new URL('cordis.patch.yml', ROOT), 'utf8');

/** Load `lib/client.js` and return the one registration it makes. */
function loadClient() {
  /** @type {any} */
  let registration;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(value) {
          registration = value;
        }
      }
    }
  };
  vm.runInNewContext(readFileSync(new URL('lib/client.js', ROOT), 'utf8'), sandbox, {
    filename: 'lib/client.js'
  });
  assert.ok(registration, 'client.js must register a module-loader factory');
  return registration;
}

/** Minimal React stand-in: the factory only defines components here. */
const react = {
  createElement() {
    return null;
  },
  useState() {
    return [undefined, () => {}];
  },
  useEffect() {},
  useRef() {
    return { current: undefined };
  }
};

/** Fake host context that records effects and slot registrations. */
function createContext() {
  const effects = [];
  const locales = [];
  const injections = [];
  const registrations = [];
  const scope = {
    getSnapshot: () => ({ status: 'ready', value: {}, revision: 0, writable: true }),
    subscribe: () => () => {},
    mutate: async () => true
  };
  return {
    effects,
    locales,
    injections,
    registrations,
    scope,
    ctx: {
      effect(callback, name) {
        effects.push({ callback, name });
        return () => {};
      },
      locale: {
        bind(namespace) {
          assert.equal(namespace, 'dsh-live-proxy');
          return (key) => key;
        },
        register(namespace, dictionaries) {
          locales.push({ namespace, dictionaries });
          return () => {};
        }
      },
      configForms: {
        get(namespace) {
          assert.equal(namespace, 'dsh-live-proxy');
          return scope;
        },
        whileServed(namespaces, register) {
          assert.deepEqual([...namespaces], ['dsh-live-proxy']);
          return register(new Set(namespaces));
        }
      },
      slots: {
        inject(key, callback) {
          injections.push(key);
          return callback();
        },
        register(options, component) {
          registrations.push({ options, component });
          return () => {};
        }
      }
    }
  };
}

test('client module id and row key match the installed package and row', () => {
  const registration = loadClient();
  assert.equal(registration.id, pkg.name, 'module id must be the package name');
  assert.equal(typeof registration.factory, 'function');

  const plugin = registration.factory((specifier) => {
    assert.equal(specifier, 'react');
    return react;
  });
  assert.equal(typeof plugin.apply, 'function');

  const fake = createContext();
  plugin.apply(fake.ctx);

  assert.deepEqual([...plugin.inject].sort(), ['configForms', 'locale', 'slots']);
  assert.deepEqual(fake.injections, ['plugins.row.config']);

  for (const effect of fake.effects) effect.callback();
  assert.deepEqual(fake.injections, ['plugins.row.config', 'settings.section']);

  const row = fake.registrations.find((entry) => entry.options.name === 'plugins.row.config');
  assert.ok(row, 'the Plugins row config must register');
  assert.equal(row.options.key, `${pkg.name}#dsh-live-proxy`);
  assert.equal(row.options.locale, 'dsh-live-proxy');
  assert.equal(typeof row.component, 'function');

  const section = fake.registrations.find((entry) => entry.options.name === 'settings.section');
  assert.ok(section, 'the standalone Settings section must register');
  assert.equal(section.options.id, 'live-proxy');
  assert.equal(section.options.order, 17);
  assert.equal(section.options.locale, 'dsh-live-proxy');
  assert.equal(typeof section.options.label, 'function');
  assert.equal(typeof section.component, 'function');
  assert.equal(section.options.inject().scope, fake.scope);

  assert.ok(patch.includes('id: dsh-live-proxy'), 'the bundle patch must declare the row id used by the key');
});

test('client half registers both shipped dictionaries and cleans up styles', () => {
  const registration = loadClient();
  const plugin = registration.factory(() => react);
  const fake = createContext();
  plugin.apply(fake.ctx);

  for (const effect of fake.effects) effect.callback();
  assert.deepEqual(fake.locales.map((entry) => entry.namespace), ['dsh-live-proxy']);
  const dictionaries = fake.locales[0].dictionaries;
  assert.deepEqual(Object.keys(dictionaries).sort(), ['en', 'zh']);
  for (const locale of ['en', 'zh']) {
    assert.equal(typeof dictionaries[locale].title, 'string');
    assert.equal(typeof dictionaries[locale].summary, 'string');
    assert.equal(typeof dictionaries[locale].save, 'string');
  }
});

test('client half ships exported locale metadata and icon', () => {
  for (const locale of ['en', 'zh']) {
    const meta = JSON.parse(readFileSync(new URL(`locale/${locale}.json`, ROOT), 'utf8')).meta;
    assert.equal(typeof meta.title, 'string');
    assert.ok(meta.title.length > 0);
    assert.equal(typeof meta.description, 'string');
    assert.ok(meta.description.length > 0);
  }
  assert.equal(pkg.icon, './icon.svg');
  assert.equal(pkg.exports['./icon'], './icon.svg');
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json');
});
