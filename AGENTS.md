# Userscript Loader 组件

## 项目
动态脚本加载器组件，用于页面动态注入 JS，支持多源回退加载。

## 产物
- `mon/userscript-loader.js` — 核心组件，通过 `@require` 引用
- 主脚本通过 `@require` + `UserscriptLoader.createLoader()` 使用

## 架构

| 模块 | 职责 |
|---|---|
| `createFetcher(timeout)` | GM_xmlhttpRequest 的 Promise 包装，含 guard 兜底（防端口断开挂起） |
| `tokenManager()` | GM_getValue/setValue 封装，自动弹窗请求 Token |
| `scriptInjector()` | `inject(code)` 文本注入 + `injectUrl(url)` script 标签注入，ID 带随机后缀 |
| `createFallbackLoader(fetcher)` | 多源顺序尝试，直到成功 |
| `cacheLayer(prefix)` | 基于版本号 + 过期时间的 GM 缓存 |
| `createSources(fetcher)` | 源工厂：`.local()` `.gitee()` `.github()` `.jsdelivr()` `.unpkg()` `.custom()` |
| `createLoader(config)` | 主装配，返回 `{ load, loadUrl, loadRemote, fetcher, tokens, injector, cache, sources, fallback }` |

## 关键决策

1. **`@require` 文件不需要 metadata block**，已改为纯注释，主脚本自行声明 `@grant`
2. **主脚本必须声明：** `GM_xmlhttpRequest`、`GM_getValue`、`GM_setValue`、`GM_deleteValue`、`GM_listValues` + 所需 `@connect`
3. **script 标签 ID 带随机后缀**，清除时用 `[id^="__userscript_loader_dynamic"]` 匹配
4. **guard 超时机制**：`timeout + 3s` 兜底 reject，防止端口断开导致 Promise 永不结算
5. **读取 Token 方式**：`@require` 脚本内用 `window.UserscriptLoader.createLoader()`，Token 通过 `loader.tokens.getOrPrompt(key, label)` 交互式输入

## 托管方案
- 代码放 GitHub 公开仓库
- 通过 jsDelivr CDN 引用：`https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}`
- 版本控制用 git tag，避免缓存问题

## 主脚本示例

```js
// ==UserScript==
// @name         动态加载
// @require      https://cdn.jsdelivr.net/gh/xxx/tool@master/mon/userscript-loader.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @connect      127.0.0.1
// @connect      gitee.com
// ==/UserScript==

(function () {
  'use strict';

  const loader = UserscriptLoader.createLoader({ timeout: 15000 });
  const token = loader.tokens.getOrPrompt('GITEE_TOKEN', 'Gitee Token');

  loader.load([
    loader.sources.local('http://127.0.0.1:18080/chsi-local.js'),
    loader.sources.gitee({ owner: 'xxx', repo: 'tool', path: 'TaMon/chsi-local.js', token }),
  ], { cacheKey: 'chsi-script', version: '1.0' }).catch(e => {
    console.error('[Loader] 全部失败:', e.message);
  });

  window.ChsiLoader = loader;
})();
```
