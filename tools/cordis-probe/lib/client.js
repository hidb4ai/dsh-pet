/**
 * Browser-side Cordis probe for third-party consumers of dsh-pet services.
 *
 * The read-only `petApi7340` service belongs to the current DSH page's Cordis container. A separate page, process or
 * curl request cannot access it.
 * Install this ordinary client plugin in that page; it discovers services through `ctx.get()` and displays results in
 * a persistent bottom-right panel.
 * The HTTP tester covers `/state` , `/anim` and `/pose` ; this probe covers in-page services without network requests.
 *
 * DSH offers client slots rather than arbitrary browser routes. A different URL creates a different window/container,
 * so the panel has no route or hash trigger.
 * Discover services through `ctx.reflect.props` and filter providers by `Impl.fiber.name` matching dsh-pet's
 * `name: 'pet'` .
 * Parse comma-separated method arguments individually with `JSON.parse` , allowing calls such as
 * `petApi7340.pose("main")` .
 * Exclude DSH platform services. If reflect is unavailable, fall back to the explicit service list.
 *
 * Keep this a classic script with an IIFE, not top-level import/export or const declarations. DSH may execute it
 * repeatedly after rebuilding or retrying a bundle;
 * remove the old panel by ROOT_ID before creating its replacement.
 */

;(() => {
  'use strict';

  /** Plugin id: Consistent with name of package.json, the DSH module system deduplicate it. */
  const PLUGIN_ID = 'dsh-cordis-probe';

  /** Panel root node id, used to remove the old panel during repeated execution. */
  const ROOT_ID = 'cordis-probe-root';

  /** Style sheet deduplicate tag (same set of `data-plugin-css` conventions as dsh-pet). */
  const STYLE_TAG = 'dsh-cordis-probe/probe.css';

  /** The voice switch route set by the host: GET read status, POST flip. */
  const VOICE_ROUTE = '/cordis-probe-voice';
  /** The recognition switch is the same as the voice, only the path is different. */
  const SPEECH_ROUTE = '/cordis-probe-speech';
  /** The memory switch is the same as the voice, only the path is different. */
  const MEMORY_ROUTE = '/cordis-probe-memory';

  /** The fallback service name when the service ownership cannot be detected (keeps the panel always available). */
  const FALLBACK_SERVICES = ['petApi7340'];

  /**
   * dsh-pet is used for `name` client plugin registration (see `const name = 'pet'` for dsh-pet/src/client/app.ts).
   *
   * Used to select the "services provided by this plugin" from the dozens of services on the DSH platform:
   * `Fiber.name` will inherit from the nearest famous ancestor, so the service `ctx.provide()` in dsh-pet is its
   * fiber.name.
   */
  const OWNER_NAMES = ['pet', 'dsh-pet'];

  /**
   * Panel style.
   *
   * Fixed the lower right corner, shallow bottom and dark characters. When `prefers-color-scheme: dark` is turned into
   * a dark bottom - DSH, even if the theme is cut, this piece will not become mushy. `z-index` takes 1/10 of the
   * 32-bit upper limit and puts it above the pet overlay (1000), but it will not squeeze out DSH's own modal box.
   */
  const CSS = [
    '.cp-root{position:fixed;right:16px;bottom:16px;width:440px;max-height:72vh;overflow:auto;',
    'z-index:214748300;box-sizing:border-box;background:#fff;color:#18181b;',
    'border:1px solid #d4d4d8;border-radius:10px;box-shadow:0 10px 32px rgba(0,0,0,.18);',
    'font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:10px 12px}',
    '.cp-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
    '.cp-title{font-weight:700;font-size:13px;flex:1}',
    '.cp-btn{font:inherit;cursor:pointer;padding:1px 7px;border:1px solid #d4d4d8;',
    'border-radius:5px;background:#fafafa;color:inherit}',
    '.cp-btn:hover{background:#f0f0f1}',
    '.cp-note{color:#71717a;margin-bottom:8px;word-break:break-all}',
    '.cp-in{font:inherit;flex:1;min-width:0;padding:2px 6px;border:1px solid #d4d4d8;border-radius:5px}',
    '.cp-list{border-top:1px solid #e4e4e7}',
    '.cp-row{display:flex;align-items:center;gap:7px;padding:3px 0;cursor:pointer;',
    'border-bottom:1px solid #f1f1f2}',
    '.cp-dot{width:7px;height:7px;border-radius:50%;flex:none;background:#a1a1aa}',
    '.cp-dot.on{background:#16a34a}',
    '.cp-name{flex:1;word-break:break-all}',
    '.cp-type{color:#71717a;font-size:11px}',
    '.cp-members{padding:4px 0 6px 14px;border-bottom:1px solid #f1f1f2}',
    '.cp-member{display:flex;align-items:center;gap:6px;padding:1px 0}',
    '.cp-key{flex:1;word-break:break-all}',
    '.cp-out{margin-top:8px;padding-top:8px;border-top:1px solid #e4e4e7;',
    'white-space:pre-wrap;word-break:break-all;color:#3f3f46;max-height:32vh;overflow:auto}',
    '.cp-err{color:#b91c1c}',
    '@media (prefers-color-scheme: dark){',
    '.cp-root{background:#18181b;color:#e4e4e7;border-color:#3f3f46;box-shadow:0 10px 32px rgba(0,0,0,.5)}',
    '.cp-btn{background:#27272a;border-color:#3f3f46}',
    '.cp-btn:hover{background:#3f3f46}',
    '.cp-note,.cp-type{color:#a1a1aa}',
    '.cp-in{background:#27272a;color:inherit;border-color:#3f3f46}',
    '.cp-list,.cp-members,.cp-out{border-color:#3f3f46}',
    '.cp-row,.cp-member{border-color:#27272a}',
    '.cp-out{color:#d4d4d8}',
    '.cp-err{color:#fca5a5}',
    '}',
  ].join('');

  /** Inject stylesheet (only once). */
  function injectCss() {
    const doc = document;
    if (doc.querySelector('style[data-plugin-css="' + STYLE_TAG + '"]') !== null) return;
    const tag = doc.createElement('style');
    tag.dataset.plugin = 'cordis-probe';
    tag.dataset.pluginCss = STYLE_TAG;
    tag.textContent = CSS;
    doc.head.appendChild(tag);
  }

  /** Create an element, optional className and text. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className !== undefined) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Exception → Single line copy. */
  function describe(error) {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Determine whether a service is provided by dsh-pet.
   *
   * The service name is a bare word (`petApi7340`) and has no namespace, so we can only check the provider along
   * `Impl.fiber.name` . `_getImpl` is the internal method of cordis (reflect.js:766). When the fiber name cannot be
   * obtained, it is reduced to a fixed list - it is better to have fewer lists than to mix in the services of the DSH
   * platform.
   *
   * @param reflect - `ctx.reflect` .
   * @param serviceName - The service name to be determined.
   * Whether @returns belongs to dsh-pet.
   */
  function isOurs(reflect, serviceName) {
    try {
      const impl = reflect && typeof reflect._getImpl === 'function' ? reflect._getImpl(serviceName, false) : undefined;
      const owner = impl && impl.fiber ? impl.fiber.name : undefined;
      if (owner !== undefined) return OWNER_NAMES.indexOf(owner) >= 0;
    } catch (error) {
      // If you can’t get ownership, just rely on the list
    }
    return FALLBACK_SERVICES.indexOf(serviceName) >= 0;
  }

  /**
   * Enumerate services to `{ name, value }` .
   *
   * `ctx.reflect.props` is all the declared context attributes of this page (service + accessor). First filter by
   * `type === 'service'` , then filter by **provider** - the panel only cares about dsh-pet's own services.
   *
   * @param ctx - DSH injected Cordis ctx.
   * @returns Service List.
   */
  function listServices(ctx) {
    let reflect;
    try {
      // reflect is the core service and is directly linked to ctx; ctx.get (' reflect ') is not guaranteed to be able to find it
      reflect = ctx.reflect !== undefined ? ctx.reflect : ctx.get('reflect', false);
    } catch (error) {
      reflect = undefined;
    }
    const props = reflect && reflect.props;
    let names;
    if (props && typeof props === 'object') {
      names = [];
      for (const key of Object.keys(props)) {
        const prop = props[key];
        if (prop && prop.type === 'service' && isOurs(reflect, key)) names.push(key);
      }
      names.sort();
    } else {
      names = FALLBACK_SERVICES.slice();
    }
    return names.map((serviceName) => ({ name: serviceName, value: readService(ctx, serviceName) }));
  }

  /**
   * Read a service.
   *
   * `strict = false` : Get the value even if the provider's fiber is being uninstalled - the probe wants "is this
   * thing here at all", not "can it be safely relied on at this moment". If not retrieved, return `undefined` (not
   * thrown).
   */
  function readService(ctx, serviceName) {
    try {
      return ctx.get(serviceName, false);
    } catch (error) {
      return undefined;
    }
  }

  /** Value → One-line type description on panel. */
  function typeOf(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array[' + value.length + ']';
    return typeof value;
  }

  /** The own enumerable key of the value (returns an empty array when the Proxy / host object cannot be obtained). */
  function keysOf(value) {
    if (value === null || typeof value !== 'object') return [];
    try {
      return Object.keys(value);
    } catch (error) {
      return [];
    }
  }

  /**
   * Parsing call parameters: comma separated, segment by segment `JSON.parse` .
   *
   * The segment that fails to be parsed is treated as a string as it is (no error is reported) - eliminating the need
   * to write quotes in order to pass `main` .
   *
   * @param text - Input box content.
   * @returns parameter array; empty input returns an empty array.
   */
  function parseArgs(text) {
    const trimmed = text.trim();
    if (trimmed === '') return [];
    return trimmed.split(',').map((part) => {
      const piece = part.trim();
      try {
        return JSON.parse(piece);
      } catch (error) {
        return piece;
      }
    });
  }

  /** Result → readable text (not exploded when circular reference/not serializable). */
  function stringify(value) {
    if (value === undefined) return 'undefined';
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return String(value);
    }
  }

  window.__ModuleLoader__.load({
    id: PLUGIN_ID,
    factory(require) {
      const name = 'cordis-probe';
      const inject = [];

      /**
       * @param ctx - DSH injected Cordis ctx.
       * @returns disposer: Take off the panel and monitor with hash.
       */
      function apply(ctx) {
        if (typeof document === 'undefined' || document.body === null) {
          console.warn("[cordis-probe] document unavailable; skipping the panel");
          return () => {};
        }
        // Repeated execution of protection: bundle reconstruction / combo retry will run this file again
        const stale = document.getElementById(ROOT_ID);
        if (stale !== null) stale.remove();

        injectCss();

        const root = el('div', 'cp-root');
        root.id = ROOT_ID;

        // —— Head ——
        const head = el('div', 'cp-head');
        head.appendChild(el('span', 'cp-title', 'Cordis 服务探针'));
        const refreshBtn = el('button', 'cp-btn', '刷新');
        // There is a switch for voice, recognition and memory: registered in the host (Node), the button is on this
        // page, there is no direct channel between the two halves, so take the small route opened by the host. The
        // default is disable; click once to flip once, and the copy will follow the status returned by the server.
        const makeToggleButton = (route, label, onText, offText) => {
          const button = el('button', 'cp-btn', label + '：关');
          const sync = async (method) => {
            try {
              const res = await fetch(route, { method });
              const body = await res.json();
              button.textContent = label + '：' + (body.on === true ? '开' : '关');
              write(body.on === true ? onText : offText);
            } catch (e) {
              write(label + '开关请求失败：' + (e instanceof Error ? e.message : String(e)), true);
            }
          };
          button.addEventListener('click', () => void sync('POST'));
          void sync('GET');
          return button;
        };
        const voiceBtn = makeToggleButton(
          VOICE_ROUTE,
          '语音',
          'mock 语音已打开：再让桌宠说一句，会听到一声提示音。',
          'mock 语音已关闭：合成回到内置实现。',
        );
        const speechBtn = makeToggleButton(
          SPEECH_ROUTE,
          '识别',
          'mock 识别已打开：再发一段音频给 /voice/hear，会回来一段带字节数的假文字。',
          'mock 识别已关闭：识别回到宿主自带能力。',
        );
        const memoryBtn = makeToggleButton(
          MEMORY_ROUTE,
          '记忆',
          'mock 记忆已打开：发「你记得我刚才说了什么吗」，回复里会带 mock 证据。',
          'mock 记忆已关闭：对话回到原生记忆。',
        );
        const closeBtn = el('button', 'cp-btn', '×');
        head.appendChild(refreshBtn);
        head.appendChild(voiceBtn);
        head.appendChild(speechBtn);
        head.appendChild(memoryBtn);
        head.appendChild(closeBtn);
        root.appendChild(head);

        root.appendChild(el('div', 'cp-note', 'dsh-pet 提供的 Cordis 服务，同页直读，不发请求'));

        // ——Service List——
        const list = el('div', 'cp-list');
        root.appendChild(list);

        // ——Output area——
        const out = el('div', 'cp-out', '待探测。');
        root.appendChild(out);

        /** Write a result to the output area (colored red when `isError`). */
        const write = (text, isError) => {
          out.className = isError === true ? 'cp-out cp-err' : 'cp-out';
          out.textContent = text;
        };

        /**
         * The stop function of the method currently "following" (`null` = not following).
         *
         * Follow = once per frame. The call button only reads once, and you cannot see the changing quantities such as
         * `progress` ; only by following it can you see that the value is changing. Only one follower is retained at
         * the same time, and it will stop when you click the same button again.
         */
        let stopFollow = null;

        /** Rebuild the service list (retain the folded state and rely on rescanning, no additional state machine). */
        const render = () => {
          // Rebuilding will discard the old buttons together. The following loop must be stopped first, otherwise it will continue to write to the output area.
          if (stopFollow !== null) {
            stopFollow();
            stopFollow = null;
          }
          list.textContent = '';
          const services = listServices(ctx);
          if (services.length === 0) {
            list.appendChild(el('div', 'cp-type', '没有扫描到 dsh-pet 提供的服务（插件可能没启用）'));
          }
          for (const service of services) {
            const on = service.value !== undefined;

            const row = el('div', 'cp-row');
            const dot = el('span', on ? 'cp-dot on' : 'cp-dot');
            row.appendChild(dot);
            row.appendChild(el('span', 'cp-name', service.name));
            row.appendChild(el('span', 'cp-type', on ? typeOf(service.value) : '未提供'));
            list.appendChild(row);

            const members = el('div', 'cp-members');
            row.addEventListener('click', () => {
              members.style.display = members.style.display === 'none' ? 'block' : 'none';
            });

            if (on) {
              const keys = keysOf(service.value);
              if (keys.length === 0) {
                members.appendChild(el('div', 'cp-type', '（没有可枚举成员）'));
              }
              for (const key of keys) {
                let member;
                try {
                  member = service.value[key];
                } catch (error) {
                  members.appendChild(el('div', 'cp-member', key + ' — 读取失败'));
                  continue;
                }
                const line = el('div', 'cp-member');
                line.appendChild(el('span', 'cp-key', key));
                line.appendChild(el('span', 'cp-type', typeOf(member)));
                if (typeof member === 'function') {
                  const callBtn = el('button', 'cp-btn', '调用');
                  callBtn.addEventListener('click', (event) => {
                    // Don't let the click bubble to row, expand and collapse it
                    event.stopPropagation();
                    const args = parseArgs(argsInput.value);
                    try {
                      const result = member.apply(service.value, args);
                      write(
                        service.name +
                          '.' +
                          key +
                          '(' +
                          args.map((a) => stringify(a)).join(', ') +
                          ') →\n' +
                          stringify(result),
                        false,
                      );
                    } catch (error) {
                      write(service.name + '.' + key + '() 抛错：' + describe(error), true);
                    }
                  });
                  line.appendChild(callBtn);

                  // Follow: Adjust once per frame, specifically for progress quantities that "cannot be seen after reading once"
                  const followBtn = el('button', 'cp-btn', '跟随');
                  followBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    if (stopFollow !== null) {
                      stopFollow();
                      stopFollow = null;
                      followBtn.textContent = '跟随';
                      return;
                    }
                    const args = parseArgs(argsInput.value);
                    followBtn.textContent = '停止';
                    let handle = 0;
                    const tick = () => {
                      try {
                        const result = member.apply(service.value, args);
                        write(
                          service.name +
                            '.' +
                            key +
                            '(' +
                            args.map((a) => stringify(a)).join(', ') +
                            ') →\n' +
                            stringify(result),
                          false,
                        );
                      } catch (error) {
                        // Automatically stop when an error occurs. Don’t get the same error every frame.
                        window.cancelAnimationFrame(handle);
                        stopFollow = null;
                        followBtn.textContent = '跟随';
                        write(service.name + '.' + key + '() 抛错：' + describe(error), true);
                        return;
                      }
                      handle = window.requestAnimationFrame(tick);
                    };
                    handle = window.requestAnimationFrame(tick);
                    stopFollow = () => {
                      window.cancelAnimationFrame(handle);
                      followBtn.textContent = '跟随';
                    };
                  });
                  line.appendChild(followBtn);
                }
                members.appendChild(line);
              }

              const argsRow = el('div', 'cp-member');
              argsRow.appendChild(el('span', 'cp-type', '参数'));
              const argsInput = el('input', 'cp-in');
              argsInput.placeholder = '逗号分隔，如 main 或 "left",0.5';
              argsRow.appendChild(argsInput);
              members.insertBefore(argsRow, members.firstChild);
            } else {
              members.appendChild(el('div', 'cp-type', '这个页面没有提供该服务。'));
            }

            list.appendChild(members);
          }
        };

        refreshBtn.addEventListener('click', () => {
          render();
          write('已重新扫描。');
        });
        closeBtn.addEventListener('click', () => {
          root.style.display = 'none';
        });

        document.body.appendChild(root);
        render();

        // The service is provided by another plugin in **its own apply** provide, and the loading order is not
        // guaranteed: when the probe is apply first, petApi7340 does not exist yet, and it must be "not provided" when
        // it is scanned out at that moment. So scan again as soon as the service comes online.
        let off;
        try {
          off = ctx.on('internal/service', () => render());
        } catch (error) {
          off = undefined;
        }
        // fallback: If the event name changes (or events is unavailable), scan several times in the first few seconds
        const timers = [500, 1500, 3000].map((ms) => window.setTimeout(render, ms));

        return () => {
          for (const timer of timers) window.clearTimeout(timer);
          if (typeof off === 'function') off();
          root.remove();
        };
      }

      return { name, inject, apply };
    },
  });
})();
