# AI Dev Console Panel

`AI Dev Console Panel` 是一个基于 `Vue 3 + Vite + TypeScript` 构建的 Chrome Manifest V3 调试扩展，主界面运行在 `Side Panel` 中，面向“页面日志 + 请求链路 + AI 分析”的前端排障场景。

## 当前能力

- 使用 `Manifest V3`
- 点击扩展图标打开 `Side Panel`
- 采集页面 `console.log / info / warn / error`
- 捕获 `window error` 和 `unhandledrejection`
- 劫持 `fetch` 与 `XMLHttpRequest`
- 按 `tab` 独立维护日志、请求、分析结果
- 支持日志搜索
- 支持按 `log / info / warn / error` 过滤日志
- 支持按请求状态筛选 `全部 / 成功 / 异常`
- 支持自动分析最新错误
- 支持站点白名单模式
- 支持“一键仅在当前域名启用”
- 由 `background service worker` 调用远端 `/api/ai/analyze`
- AI 接口失败时自动回退到本地 `mockAnalyze`

## 目录结构

```text
Identification/
├── manifest.json
├── panel.html
├── public/
│   └── icons/
├── src/
│   ├── background/
│   │   └── service-worker.ts
│   ├── content/
│   │   ├── content-script.ts
│   │   └── page-hook.ts
│   ├── panel/
│   │   ├── App.vue
│   │   └── main.ts
│   ├── shared/
│   │   ├── analyzer/
│   │   │   └── mockAnalyze.ts
│   │   ├── messaging/
│   │   │   └── messages.ts
│   │   ├── storage/
│   │   │   └── debugStore.ts
│   │   ├── config.ts
│   │   └── types/
│   │       └── debug.ts
│   └── style.css
├── package.json
├── tsconfig.app.json
├── tsconfig.node.json
└── vite.config.ts
```

## 运行方式

1. 安装依赖

```bash
npm install
```

2. 构建扩展

```bash
npm run build
```

3. 开发时持续构建

```bash
npm run dev
```

构建产物位于 `dist/`，会同时输出：

- `panel.html`
- `background/service-worker.js`
- `content/content-script.js`
- `content/page-hook.js`
- `manifest.json`

## 在 Chrome 中加载已解压扩展

1. 打开 `chrome://extensions/`
2. 打开右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择当前项目下的 `Identification/dist`
5. 安装后点击扩展图标，会自动打开 `Side Panel`

## 调试说明

### 1. 面板没数据时先看这几个点

- 当前页面是否是 `http / https`
- 当前域名是否被白名单拦住
- 页面是否已经刷新过，以确保调试脚本在 `document_start` 阶段注入
- 页面是否使用了沙箱 iframe、特殊 CSP 或 Worker 场景

### 2. 如何验证采集是否正常

- 打开目标页面
- 刷新页面
- 在页面上触发一次接口请求或控制台输出
- 回到 Side Panel 查看日志和请求列表

### 3. 如何验证 AI 接口

插件默认调用：

```text
https://api.haoyl2025.cn/api/ai/analyze
```

如果你想切换到别的后端地址，可以在构建前设置：

```bash
VITE_AI_ANALYZE_ENDPOINT=https://your-domain.com/api/ai/analyze npm run build
```

## manifest.json 关键字段说明

- `manifest_version: 3`
  表示这是 Chrome MV3 扩展。
- `action`
  扩展图标点击后打开调试面板。
- `side_panel.default_path`
  指向插件内部的 `panel.html`。
- `background.service_worker`
  后台负责消息通信、tab 级状态存储、AI 请求、自动分析和白名单控制。
- `permissions`
  当前仅申请：
  - `storage`
  - `tabs`
  - `sidePanel`
- `host_permissions`
  当前只给远端 AI 接口域名：
  - `https://api.haoyl2025.cn/*`
- `content_scripts`
  负责在 `document_start` 时注入桥接脚本和主世界 hook。

## 数据与隔离方案

### tab 级隔离

- 每个标签页都有独立的 `DebugTabState`
- background 通过 `sender.tab?.id` 把日志和请求写回对应 tab
- side panel 默认读取当前活动 tab，但仍可切换查看其他 tab 会话

### storage 结构

当前主要使用 `chrome.storage.local`：

```json
{
  "ai-dev-console:tab-state": {
    "123": {
      "tabId": 123,
      "pageUrl": "https://example.com/page",
      "isReady": true,
      "pageReadyAt": "2026-03-19T12:00:00.000Z",
      "logs": [],
      "requests": [],
      "latestError": null,
      "analysis": null,
      "updatedAt": "2026-03-19T12:00:00.000Z"
    }
  },
  "ai-dev-console:settings": {
    "autoAnalyzeLatestError": false,
    "whitelistEnabled": false,
    "allowedDomains": []
  }
}
```

## 白名单与域名控制

- 当 `whitelistEnabled = false` 时，所有 `http / https` 站点默认启用
- 当 `whitelistEnabled = true` 时，只有 `allowedDomains` 中的域名会继续采集和分析
- “仅在当前域名启用” 会自动：
  - 打开白名单模式
  - 把当前域名设为唯一允许域名

## 图标资源检查

当前项目已经提供扩展可加载所需的基础图标路径，但仍属于占位资源。  
后续发布 Chrome Web Store 前，建议补齐这些正式素材：

- 扩展图标：`16x16`、`32x32`、`48x48`、`128x128`
- Chrome Web Store 宣传图：`440x280`
- 商店截图：至少 1 张，建议准备深色面板实机截图

## 当前权限范围

当前版本没有额外扩大权限范围，仍然尽量保持最小：

- `storage`
- `tabs`
- `sidePanel`
- `host_permissions` 仅远端 AI 接口域名

这意味着：

- 插件不会额外申请 `webRequest`
- 也没有启用 `debugger`

如果未来要做更接近 DevTools Network 的底层抓包，再单独评估是否需要扩权。

## 当前版本仍待增强

- 还没有真正持久化“关闭 tab 后的最近会话历史”
- 还没有采集请求头、响应头、Cookie
- 还没有做 AI 结果的 markdown/code block 高亮
- 还没有为 Chrome Web Store 补正式图标、隐私政策和商店文案
