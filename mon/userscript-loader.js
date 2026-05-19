// Userscript Loader — 动态脚本加载器（可复用）v0.1.0
// 通过 @require 引用，提供 fallback 多源加载、缓存、版本控制能力
// 主脚本需自行声明：GM_xmlhttpRequest, GM_getValue, GM_setValue, GM_deleteValue, GM_listValues

(function (global) {
  'use strict';

  // -------------------------------------------
  // ① 工具函数
  // -------------------------------------------

  const noop = () => {};

  function typeOf(val) {
    return Object.prototype.toString.call(val).slice(8, -1).toLowerCase();
  }

  function isPlainObject(val) {
    return typeOf(val) === 'object';
  }

  function assign(target, ...sources) {
    for (const src of sources) {
      if (isPlainObject(src)) {
        for (const key of Object.keys(src)) {
          target[key] = src[key];
        }
      }
    }
    return target;
  }

  // -------------------------------------------
  // ② GM_xmlhttpRequest 包装：文本 / JSON
  // -------------------------------------------

  function createFetcher(timeout = 15000) {
    function request(url, opts = {}) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const guard = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error('Request never settled (port disconnected?)'));
          }
        }, timeout + 3000);

        try {
          GM_xmlhttpRequest(assign({
            method: 'GET',
            url,
            timeout,
            responseType: opts.responseType || 'text',
            onload(res) {
              if (settled) return;
              settled = true;
              clearTimeout(guard);
              if (res.status >= 200 && res.status < 300) {
                const text = opts.responseType === 'json' ? res.response : res.responseText;
                console.log('[Loader] 响应长度:', text.length, 'URL:', url.slice(0, 120));
                resolve(text);
              } else {
                reject(new Error(`HTTP ${res.status}`));
              }
            },
            onerror(err) {
              if (settled) return;
              settled = true;
              clearTimeout(guard);
              reject(new Error(`NetworkError: ${JSON.stringify(err)}`));
            },
            ontimeout() {
              if (settled) return;
              settled = true;
              clearTimeout(guard);
              reject(new Error(`Timeout (${timeout}ms)`));
            },
            onabort() {
              if (settled) return;
              settled = true;
              clearTimeout(guard);
              reject(new Error('Aborted'));
            }
          }, opts.overrides || {}));
        } catch (e) {
          if (!settled) {
            settled = true;
            clearTimeout(guard);
            reject(new Error(`GM_xmlhttpRequest 异常: ${e.message}`));
          }
        }
      });
    }

    request.json = function (url, opts = {}) {
      return request(url, assign({}, opts, { responseType: 'json' }));
    };

    return request;
  }

  // -------------------------------------------
  // ③ Token 管理（GM Storage）
  // -------------------------------------------

  function tokenManager() {
    const store = {
      get(key) { return GM_getValue(key); },
      set(key, val) { GM_setValue(key, val); },
      delete(key) { GM_deleteValue(key); },
      list() { return GM_listValues(); }
    };

    return {
      getOrPrompt(key, label = 'Token') {
        let token = store.get(key);
        if (!token) {
          token = prompt(`请输入 ${label}`);
          if (!token) throw new Error(`未提供 ${label}`);
          store.set(key, token);
        }
        return token;
      },
      set(key, val) { store.set(key, val); },
      remove(key) { store.delete(key); }
    };
  }

  // -------------------------------------------
  // ④ 注入脚本到页面
  // -------------------------------------------

  function scriptInjector() {
    function scriptId() { return '__userscript_loader_dynamic_' + Math.random().toString(36).slice(2, 8); }

    function inject(code, source = 'unknown') {
      const id = scriptId();
      const old = document.querySelector('[id^="__userscript_loader_dynamic"]');
      if (old) old.remove();

      const script = document.createElement('script');
      script.id = id;
      script.type = 'text/javascript';
      script.dataset.source = source;
      script.textContent = code;
      document.documentElement.appendChild(script);

      return { source };
    }

    function injectUrl(url, source) {
      const id = scriptId();
      const old = document.querySelector('[id^="__userscript_loader_dynamic"]');
      if (old) old.remove();

      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.id = id;
        script.type = 'text/javascript';
        script.dataset.source = source || url;
        script.src = url;
        script.onload = () => resolve({ source: source || url });
        script.onerror = () => reject(new Error(`Script onerror: ${url}`));
        document.documentElement.appendChild(script);
      });
    }

    return { inject, injectUrl };
  }

  // -------------------------------------------
  // ⑤ 多源 Fallback 加载器
  // -------------------------------------------

  function createFallbackLoader(fetcher) {
    return async function fallbackLoad(sources) {
      const list = Array.isArray(sources) ? sources : [sources];

      for (const item of list) {
        const name = item.name || item.label || item.source || 'unknown';
        try {
          if (typeof item.loader === 'function') {
            const code = await item.loader();
            return { code, source: name };
          }
          if (typeof item.url === 'string') {
            const code = await fetcher(item.url);
            return { code, source: name };
          }
          throw new Error('无效的 source 配置');
        } catch (e) {
          console.error(`[Loader] ${name} 失败:`, e.message);
        }
      }

      throw new Error('所有加载源均失败');
    };
  }

  // -------------------------------------------
  // ⑥ 缓存包装（基于版本号）
  // -------------------------------------------

  function cacheLayer(prefix = 'ul_cache') {
    function key(id) { return `${prefix}_${id}`; }

    return {
      get(id) {
        const raw = GM_getValue(key(id));
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
      },
      set(id, data, version) {
        GM_setValue(key(id), JSON.stringify({ v: version || 1, data, t: Date.now() }));
      },
      isValid(id, maxAge, currentVersion) {
        const cached = this.get(id);
        if (!cached) return false;
        if (currentVersion !== undefined && cached.v !== currentVersion) return false;
        if (maxAge !== undefined && (Date.now() - cached.t) > maxAge) return false;
        return true;
      },
      remove(id) { GM_deleteValue(key(id)); },
      bust(id) { this.remove(id); }
    };
  }

  // -------------------------------------------
  // ⑦ Source 工厂：构建常见加载源
  // -------------------------------------------

  function createSources(fetcher) {
    return {
      local(url) {
        return {
          name: 'local',
          url,
          loader: () => fetcher(url)
        };
      },

      gitee({ owner, repo, path, branch = 'master', token }) {
        const encodedPath = path.split('/').map(encodeURIComponent).join('%2F');
        const apiUrl = 'https://gitee.com/api/v5/repos/' +
          encodeURIComponent(owner) + '/' +
          encodeURIComponent(repo) + '/raw/' +
          encodedPath +
          '?access_token=' + encodeURIComponent(token) +
          '&ref=' + encodeURIComponent(branch);

        return {
          name: 'gitee',
          url: apiUrl,
          loader: () => fetcher(apiUrl)
        };
      },

      github({ owner, repo, path, branch = 'main', token }) {
        const rawUrl = token
          ? `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`
          : `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;

        return {
          name: 'github',
          url: rawUrl,
          loader: async () => {
            if (token) {
              const json = await fetcher.json(rawUrl, {
                overrides: {
                  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3.raw' }
                }
              });
              return typeof json === 'string' ? json : json.content;
            }
            return fetcher(rawUrl);
          }
        };
      },

      jsdelivr({ owner, repo, path, version = 'latest' }) {
        const url = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${version}/${path}`;
        return { name: 'jsdelivr', url, loader: () => fetcher(url) };
      },

      unpkg(pkgPath) {
        const url = `https://unpkg.com/${pkgPath}`;
        return { name: 'unpkg', url, loader: () => fetcher(url) };
      },

      custom(name, loader) {
        return { name, loader };
      }
    };
  }

  // -------------------------------------------
  // ⑧ 主装配：createLoader()
  // -------------------------------------------

  function createLoader(userConfig = {}) {
    const config = assign({
      timeout: 15000,
      debug: true,
      cachePrefix: 'ul_cache',
      maxCacheAge: 5 * 60 * 1000  // 5 分钟
    }, userConfig);

    const fetcher = createFetcher(config.timeout);
    const tokens = tokenManager();
    const injector = scriptInjector();
    const fallback = createFallbackLoader(fetcher);
    const cache = cacheLayer(config.cachePrefix);
    const sources = createSources(fetcher);

    function log(...args) {
      if (config.debug) console.log('[Loader]', ...args);
    }

    // 核心 API：根据配置列表加载并注入
    async function load(sourcesList, options = {}) {
      const { skipInject = false } = options;

      // ① 检查缓存
      if (options.cacheKey && cache.isValid(options.cacheKey, options.cacheMaxAge || config.maxCacheAge, options.version)) {
        const cached = cache.get(options.cacheKey);
        log('使用缓存:', options.cacheKey);
        if (!skipInject) {
          injector.inject(cached.data, `cache:${options.cacheKey}`);
        }
        return { source: 'cache', code: cached.data };
      }

      // ② 多源 fallback
      const result = await fallback(sourcesList.map(s => ({
        name: s.name || s.source,
        loader: typeof s.loader === 'function' ? s.loader : (() => fetcher(s.url))
      })));

      // ③ 写入缓存
      if (options.cacheKey && result.code) {
        cache.set(options.cacheKey, result.code, options.version);
      }

      // ④ 注入
      if (!skipInject) {
        injector.inject(result.code, result.source);
      }

      log('加载完成，来源:', result.source);
      return result;
    }

    // 便捷加载单个 URL
    async function loadUrl(url, sourceName) {
      const code = await fetcher(url);
      injector.inject(code, sourceName || url);
      return { code, source: sourceName || url };
    }

    // 便捷加载远程 script 标签
    function loadRemote(url, sourceName) {
      return injector.injectUrl(url, sourceName);
    }

    return {
      load,
      loadUrl,
      loadRemote,
      fetcher,
      tokens,
      injector,
      cache,
      sources,
      fallback,
      config: () => assign({}, config)
    };
  }

  // -------------------------------------------
  // ⑨ 导出
  // -------------------------------------------

  const UserscriptLoader = { createLoader, version: '0.1.0' };

  // 挂到全局，其他脚本通过 window.UserscriptLoader 访问
  global.UserscriptLoader = UserscriptLoader;

  // 如果用了 @require，也可以 export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UserscriptLoader;
  }

})(typeof window !== 'undefined' ? window : globalThis);
