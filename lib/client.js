/**
 * dsh-live-proxy browser half: the configuration page of the `dsh-live-proxy`
 * row on the Plugins page.
 *
 * This DSH release does not render a generic form for a bundle row. The
 * Plugins page declares the keyed `plugins.row.config` slot and passes the
 * entry's form (`state` + `mutate`) to whoever registers the row's key; a row
 * without an occupant shows no Configure control at all. This module is that
 * occupant, so the proxy fields become editable without hand-editing the
 * profile patch.
 *
 * The component writes through the owner-provided `form.mutate(ops, revision)`
 * rather than importing a Harness client package: the slot props are the
 * supported cross-plugin face, and only React is taken from the browser module
 * table.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-live-proxy',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace owned by this plugin. */
    const NS = 'dsh-live-proxy';
    /** `plugins.row.config` dispatch key: `<bundle package name>#<row id>`. */
    const ROW_KEY = '@local/dsh-live-proxy#dsh-live-proxy';
    /** Editable fields, in display order. Mirrors the Host Config schema. */
    const FIELDS = ['mode', 'proxyUrl', 'noProxy', 'fallbackToDirect', 'probeIntervalMs', 'probeTimeoutMs'];

    const zh = {
      title: '实时代理',
      settingsLabel: '代理',
      settingsTitle: '代理',
      settingsIntro: '在这里切换 DSH 的出站代理，保存后立即生效，不需要重启。',
      summary: '不重启就能切换 DSH 的出站代理；代理不可达时自动直连，恢复后自动切回。',
      intro: '改完保存立即生效，不需要重启 DSH。',
      mode: '模式',
      modeDirect: '直连',
      modeManual: '手动代理',
      modeHint: 'direct 忽略一切代理；manual 使用下面的代理地址。',
      proxyUrl: '代理地址',
      proxyUrlHint: '只支持 http:// 或 https://，填代理软件的 HTTP 端口；裸写 host:port 会自动补 http://。',
      noProxy: '直连例外',
      noProxyHint: '逗号分隔的主机名或域名后缀；本机回环地址由 DSH 自动排除。',
      fallback: '代理不可达时自动直连',
      fallbackHint: '只探测代理端口是否在监听；代理恢复后自动切回。',
      interval: '探测周期（毫秒）',
      intervalHint: '0 表示关闭探测。',
      timeout: '单次探测超时（毫秒）',
      timeoutHint: '范围 100–60000。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存，立即生效',
      discard: '放弃修改',
      reset: '恢复默认',
      readOnly: '当前部署的设置是只读的。',
      unavailable: '插件当前未加载，暂时无法配置。',
      loading: '正在读取配置…',
      noForm: '宿主还没有发布这个插件的配置表单。',
      saveFailed: '宿主没有接受这些值，已保留供你修改。',
      invalidMode: '请选择 direct 或 manual。',
      invalidUrl: 'manual 模式需要一个 http:// 或 https:// 地址。',
      invalidSocks: 'DSH 不接受 SOCKS：请填代理软件的 HTTP 端口。',
      invalidNumber: '请填写范围内的整数。'
    };

    const en = {
      title: 'Live proxy',
      settingsLabel: 'Proxy',
      settingsTitle: 'Proxy',
      settingsIntro: 'Switch the outbound proxy here; saving applies at once and needs no restart.',
      summary: 'Switch the outbound proxy without restarting DSH, and fall back to a direct connection while it stops answering.',
      intro: 'Saving applies at once; DSH does not need a restart.',
      mode: 'Mode',
      modeDirect: 'Direct',
      modeManual: 'Manual',
      modeHint: 'direct ignores every proxy; manual uses the address below.',
      proxyUrl: 'Proxy URL',
      proxyUrlHint: 'http:// or https:// only; use the HTTP port your proxy listens on. A bare host:port gains http://.',
      noProxy: 'Bypass hosts',
      noProxyHint: 'Comma-separated host names or domain suffixes; DSH always bypasses loopback.',
      fallback: 'Connect directly while the proxy is unreachable',
      fallbackHint: 'Only the proxy port is probed; the proxy is used again as soon as it returns.',
      interval: 'Probe interval (ms)',
      intervalHint: '0 disables probing.',
      timeout: 'Probe timeout (ms)',
      timeoutHint: 'From 100 to 60000.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved and applied',
      discard: 'Discard',
      reset: 'Reset to defaults',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      loading: 'Reading configuration…',
      noForm: 'The Host has not published this plugin\'s configuration form yet.',
      saveFailed: 'The Host did not accept these values; they were left for you to correct.',
      invalidMode: 'Choose direct or manual.',
      invalidUrl: 'manual mode needs an http:// or https:// address.',
      invalidSocks: 'DSH rejects SOCKS; use the HTTP port your proxy listens on.',
      invalidNumber: 'Enter an integer in the allowed range.'
    };

    const CSS = `
.dlp-form { display:flex; flex-direction:column; gap:14px; max-width:640px; color:var(--dsw-alias-label-primary); }
.dlp-intro { margin:0; color:var(--dsw-alias-label-secondary); font-size:13px; line-height:20px; }
.dlp-field { display:flex; flex-direction:column; gap:5px; }
.dlp-label { font-size:13px; font-weight:500; line-height:20px; }
.dlp-hint { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
.dlp-input,.dlp-select { box-sizing:border-box; width:100%; height:34px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px; padding:0 10px; outline:none; }
.dlp-input:focus,.dlp-select:focus { border-color:var(--dsw-alias-brand-primary); box-shadow:0 0 0 1px var(--dsw-alias-brand-primary); }
.dlp-input:disabled,.dlp-select:disabled { opacity:.6; }
.dlp-check { display:flex; align-items:flex-start; gap:8px; font-size:13px; line-height:20px; }
.dlp-check input { margin:2px 0 0; accent-color:var(--dsw-alias-brand-primary); }
.dlp-checkText { display:flex; flex-direction:column; gap:2px; }
.dlp-actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.dlp-button { height:32px; border-radius:8px; padding:0 14px; font:inherit; font-size:13px; cursor:pointer; }
.dlp-primary { border:1px solid transparent; background:var(--dsw-alias-label-primary); color:var(--dsw-alias-bg-base); }
.dlp-primary:disabled { opacity:.5; cursor:default; }
.dlp-secondary { border:1px solid var(--dsw-alias-border-l2); background:transparent; color:var(--dsw-alias-label-primary); }
.dlp-secondary:disabled { opacity:.5; cursor:default; }
.dlp-status { font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); }
.dlp-error { margin:0; color:var(--dsw-alias-state-error-primary); font-size:12.5px; line-height:18px; }
.dlp-ok { color:var(--dsw-alias-state-success-primary); }
.dlp-summary { color:var(--dsw-alias-label-secondary); }
.dlp-settings { display:flex; flex-direction:column; gap:12px; max-width:760px; color:var(--dsw-alias-label-primary); }
.dlp-heading { display:flex; align-items:center; gap:8px; margin:0; font-size:18px; font-weight:600; line-height:26px; }
.dlp-headingIcon { display:inline-flex; flex:none; color:currentColor; }
.dlp-settingsIntro { margin:0; color:var(--dsw-alias-label-secondary); font-size:13px; line-height:20px; }
.dlp-navItem { display:inline-flex; align-items:center; gap:8px; min-width:0; }
.dlp-navGlyph { display:inline-flex; flex:none; color:currentColor; }
.dlp-navText { overflow:hidden; text-overflow:ellipsis; }
/*
 * The settings shell maps a custom section id to its fallback gear icon
 * (navIcon() recognizes only shipped ids). The section label carries our own
 * glyph; hide the shell's gear only for the cell whose label contains it.
 * If this selector stops matching after a shell update, both glyphs show and
 * the menu keeps working.
 */
svg[class*="navIcon"]:has(+ span[class*="navLabel"] .dlp-navGlyph) { display:none; }
`;

    /**
     * Normalize a form value into the controlled draft. Numbers stay strings so
     * the inputs keep what the user typed, including a transient empty value.
     * @param {Record<string, unknown> | undefined} value
     */
    function toDraft(value) {
      const source = value ?? {};
      return {
        mode: source.mode === 'manual' ? 'manual' : 'direct',
        proxyUrl: typeof source.proxyUrl === 'string' ? source.proxyUrl : '',
        noProxy: typeof source.noProxy === 'string' ? source.noProxy : '',
        fallbackToDirect: source.fallbackToDirect !== false,
        probeIntervalMs: source.probeIntervalMs === undefined ? '15000' : String(source.probeIntervalMs),
        probeTimeoutMs: source.probeTimeoutMs === undefined ? '2000' : String(source.probeTimeoutMs)
      };
    }

    /** @param {string} text */
    function normalizeProxyUrl(text) {
      const trimmed = text.trim();
      if (trimmed === '') return '';
      return trimmed.includes('://') ? trimmed : `http://${trimmed}`;
    }

    /**
     * Cross-field validation the Host schema cannot express, mirrored locally so
     * a bad value never reaches the profile patch.
     * @param {ReturnType<typeof toDraft>} draft
     * @param {(key: string) => string} t
     * @returns {string | null} the first error, or null
     */
    function validateDraft(draft, t) {
      if (draft.mode !== 'direct' && draft.mode !== 'manual') return t('invalidMode');
      const url = normalizeProxyUrl(draft.proxyUrl);
      if (draft.mode === 'manual' && url === '') return t('invalidUrl');
      if (url !== '') {
        let parsed;
        try {
          parsed = new URL(url);
        } catch {
          return t('invalidUrl');
        }
        if (parsed.protocol === 'socks:' || parsed.protocol === 'socks4:' || parsed.protocol === 'socks5:' || parsed.protocol === 'socks5h:') return t('invalidSocks');
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return t('invalidUrl');
        if (parsed.search !== '' || parsed.hash !== '') return t('invalidUrl');
      }
      const intervalText = String(draft.probeIntervalMs).trim();
      const interval = Number(intervalText);
      if (intervalText === '' || !Number.isInteger(interval) || interval < 0 || interval > 600000) return t('invalidNumber');
      const timeoutText = String(draft.probeTimeoutMs).trim();
      const timeout = Number(timeoutText);
      if (timeoutText === '' || !Number.isInteger(timeout) || timeout < 100 || timeout > 60000) return t('invalidNumber');
      return null;
    }

    /** @param {ReturnType<typeof toDraft>} draft */
    function draftToConfig(draft) {
      return {
        mode: draft.mode,
        proxyUrl: normalizeProxyUrl(draft.proxyUrl),
        noProxy: draft.noProxy
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '')
          .join(','),
        fallbackToDirect: draft.fallbackToDirect === true,
        probeIntervalMs: Number(draft.probeIntervalMs),
        probeTimeoutMs: Number(draft.probeTimeoutMs)
      };
    }

    function sameValue(left, right) {
      return JSON.stringify(left) === JSON.stringify(right);
    }

    /**
     * One labelled control.
     * @param {{ label: string, hint?: string, children: import('react').ReactNode }} props
     */
    function Field(props) {
      return h('div', { className: 'dlp-field' },
        h('label', { className: 'dlp-label' }, props.label),
        props.children,
        props.hint === undefined ? null : h('span', { className: 'dlp-hint' }, props.hint));
    }

    /**
     * The row's configuration page (and its one-liner when the page asks for a
     * summary). Every value edits a local draft; only Save writes.
     * @param {any} props - slot props plus the owner's `{ view, form }`.
     */
    function LiveProxyForm(props) {
      const { t, form, view } = props;
      const state = form === undefined || form === null ? undefined : form.state;
      const revision = state === undefined ? undefined : state.revision;
      const [draft, setDraft] = React.useState(() => (state !== undefined && state.value !== undefined ? toDraft(state.value) : null));
      const [dirty, setDirty] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [saving, setSaving] = React.useState(false);
      const revisionRef = React.useRef(revision);

      React.useEffect(() => {
        if (state === undefined || state.status !== 'ready' || state.value === undefined) return;
        if (revisionRef.current === revision && draft !== null) return;
        revisionRef.current = revision;
        setDraft(toDraft(state.value));
        setDirty(false);
        setError(null);
      }, [revision, state, draft]);

      if (view === 'summary') {
        // The page asks for the one-liner without a `form`; keep it static.
        return h('span', { className: 'dlp-summary' }, t('summary'));
      }

      if (form === undefined || form === null) {
        return h('p', { className: 'dlp-error' }, t('noForm'));
      }
      if (state !== undefined && state.status === 'unavailable') {
        return h('p', { className: 'dlp-hint' }, t('unavailable'));
      }
      if (state === undefined || state.status !== 'ready' || draft === null) {
        return h('p', { className: 'dlp-hint' }, t('loading'));
      }

      const disabled = saving || state.writable === false;
      const edit = (key) => (event) => {
        const next = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
        setDraft((current) => (current === null ? current : { ...current, [key]: next }));
        setDirty(true);
        setNotice(null);
        setError(null);
      };

      const save = async () => {
        const problem = validateDraft(draft, t);
        if (problem !== null) {
          setError(problem);
          return;
        }
        const next = draftToConfig(draft);
        const ops = [];
        for (const field of FIELDS) {
          if (!sameValue(state.value === undefined ? undefined : state.value[field], next[field])) {
            ops.push({ op: 'set', path: [field], value: next[field] });
          }
        }
        if (ops.length === 0) {
          setDirty(false);
          return;
        }
        setSaving(true);
        setError(null);
        setNotice(null);
        try {
          const accepted = await form.mutate(ops, revision);
          if (accepted === false) {
            setError(t('saveFailed'));
            return;
          }
          setDraft(toDraft(next));
          setDirty(false);
          setNotice(t('saved'));
        } catch (cause) {
          setError(String(cause === null || cause === undefined ? cause : (cause.message ?? cause)));
        } finally {
          setSaving(false);
        }
      };

      const reset = async () => {
        setSaving(true);
        setError(null);
        setNotice(null);
        try {
          const accepted = await form.mutate(FIELDS.map((field) => ({ op: 'unset', path: [field] })), revision);
          if (accepted === false) {
            setError(t('saveFailed'));
            return;
          }
          setDirty(false);
          setNotice(t('saved'));
        } catch (cause) {
          setError(String(cause === null || cause === undefined ? cause : (cause.message ?? cause)));
        } finally {
          setSaving(false);
        }
      };

      const discard = () => {
        setDraft(toDraft(state.value));
        setDirty(false);
        setError(null);
        setNotice(null);
      };

      return h('div', { className: 'dlp-form' },
        h('p', { className: 'dlp-intro' }, t('intro')),
        state.writable === false ? h('p', { className: 'dlp-error' }, t('readOnly')) : null,
        h(Field, { label: t('mode'), hint: t('modeHint') },
          h('select', { className: 'dlp-select', value: draft.mode, disabled, onChange: edit('mode') },
            h('option', { value: 'direct' }, t('modeDirect')),
            h('option', { value: 'manual' }, t('modeManual')))),
        h(Field, { label: t('proxyUrl'), hint: t('proxyUrlHint') },
          h('input', {
            className: 'dlp-input',
            type: 'text',
            value: draft.proxyUrl,
            placeholder: 'http://127.0.0.1:7897',
            spellCheck: false,
            disabled,
            onChange: edit('proxyUrl')
          })),
        h(Field, { label: t('noProxy'), hint: t('noProxyHint') },
          h('input', {
            className: 'dlp-input',
            type: 'text',
            value: draft.noProxy,
            placeholder: 'zhihu.com, .local',
            spellCheck: false,
            disabled,
            onChange: edit('noProxy')
          })),
        h('label', { className: 'dlp-check' },
          h('input', { type: 'checkbox', checked: draft.fallbackToDirect, disabled, onChange: edit('fallbackToDirect') }),
          h('span', { className: 'dlp-checkText' },
            h('span', null, t('fallback')),
            h('span', { className: 'dlp-hint' }, t('fallbackHint')))),
        h(Field, { label: t('interval'), hint: t('intervalHint') },
          h('input', {
            className: 'dlp-input',
            type: 'number',
            min: 0,
            max: 600000,
            step: 1,
            value: draft.probeIntervalMs,
            disabled,
            onChange: edit('probeIntervalMs')
          })),
        h(Field, { label: t('timeout'), hint: t('timeoutHint') },
          h('input', {
            className: 'dlp-input',
            type: 'number',
            min: 100,
            max: 60000,
            step: 1,
            value: draft.probeTimeoutMs,
            disabled,
            onChange: edit('probeTimeoutMs')
          })),
        error === null ? null : h('p', { className: 'dlp-error' }, error),
        h('div', { className: 'dlp-actions' },
          h('button', { type: 'button', className: 'dlp-button dlp-primary', disabled: disabled || !dirty, onClick: save },
            saving ? t('saving') : t('save')),
          h('button', { type: 'button', className: 'dlp-button dlp-secondary', disabled: disabled || !dirty, onClick: discard },
            t('discard')),
          h('button', { type: 'button', className: 'dlp-button dlp-secondary', disabled, onClick: reset },
            t('reset')),
          notice === null ? null : h('span', { className: 'dlp-status dlp-ok' }, notice)));
    }

    /** Leading glyph of the Settings → General → Proxy row: two exchange arrows. */
    function SwapIcon() {
      return h('svg', {
        width: 18,
        height: 18,
        viewBox: '0 0 24 24',
        'aria-hidden': 'true',
        focusable: 'false'
      },
      h('path', {
        d: 'M3.5 8.5h13M13.5 4.5l4 4-4 4',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round'
      }),
      h('path', {
        d: 'M20.5 15.5h-13M10.5 11.5l-4 4 4 4',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round'
      }));
    }

    /**
     * The standalone Settings → Proxy page. The settings shell owns the nav and
     * modal; this page subscribes to the same per-entry form controller the
     * Plugins row uses, so both surfaces show one value and one save path.
     * @param {{ t: (key: string) => string, scope: any }} props
     */
    function ProxySettingsSection(props) {
      const { t, scope } = props;
      const [state, setState] = React.useState(() => scope.getSnapshot());
      React.useEffect(() => scope.subscribe(() => setState(scope.getSnapshot())), [scope]);
      return h('div', { className: 'dlp-settings' },
        h('h2', { className: 'dlp-heading' },
          h('span', { className: 'dlp-headingIcon' }, h(SwapIcon)),
          h('span', null, t('settingsTitle'))),
        h('p', { className: 'dlp-settingsIntro' }, t('settingsIntro')),
        h(LiveProxyForm, {
          t,
          view: 'page',
          form: { state, mutate: (ops, revision) => scope.mutate(ops, revision) }
        }));
    }

    /** Append the page styles once; the returned cleanup removes them. */
    function installStyles() {
      if (typeof document === 'undefined') return () => {};
      const tag = document.createElement('style');
      tag.dataset.plugin = '@local/dsh-live-proxy';
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => {
        tag.remove();
      };
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        const scope = ctx.configForms.get(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-live-proxy: dictionaries');
        ctx.effect(installStyles, 'dsh-live-proxy: styles');
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: ROW_KEY,
          label: () => t('title'),
          locale: NS
        }, LiveProxyForm));
        // Standalone Settings → Proxy page. A custom section id makes the shell
        // render its fallback gear; the label draws our own glyph instead, and
        // the stylesheet hides the gear only for the cell carrying that glyph.
        // If a future shell changes those internal classes, both glyphs show and
        // the section still works.
        ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'live-proxy',
          order: 17,
          label: () => h('span', { className: 'dlp-navItem' },
            h('span', { className: 'dlp-navGlyph' }, h(SwapIcon)),
            h('span', { className: 'dlp-navText' }, t('settingsLabel'))),
          locale: NS,
          inject: () => ({ scope })
        }, ProxySettingsSection))), 'dsh-live-proxy: settings section');
      }
    };
  }
});
