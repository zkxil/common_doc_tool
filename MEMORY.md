# Userscript Loader — 开发记忆

## 项目目标
为脚本提供一个可复用的动态 JS 加载器组件，支持多源 fallback、缓存、版本控制。

## 产出文件
- `mon/userscript-loader.js` — 核心加载器，通过 `@require` 提供给主脚本使用

## 如何使用（主脚本）
```js
// @require  https://cdn.jsdelivr.net/gh/xxx/tool@master/mon/userscript-loader.js
// @grant    GM_xmlhttpRequest
// @grant    GM_getValue
// @grant    GM_setValue
// @grant    GM_deleteValue
// @grant    GM_listValues
// ==/UserScript==

(function () {
  const loader = UserscriptLoader.createLoader({ timeout: 15000 });
  // ...
})();
```

## 核心 API
| API | 说明 |
|---|---|
| `createLoader(config)` | 创建加载器实例 |
| `loader.load(sources, opts)` | 多源 fallback 加载，自动注入 |
| `loader.sources.local(url)` | 本地源 |
| `loader.sources.gitee({...})` | Gitee API 源（需 token） |
| `loader.sources.jsdelivr({...})` | jsDelivr CDN 源 |
| `loader.tokens.getOrPrompt(k, l)` | 交互式 Token 获取 |
| `loader.cache` | GM 缓存操作 |

## 技术决策
- 用 guard 超时解决 Tampermonkey 端口断开后 Promise 死锁
- script 标签 ID 用 `__userscript_loader_dynamic_` + 随机后缀，避免冲突
- @require 的文件不需要 metadata block，grant 由主脚本声明
