import type { AnalyzePayload, DebugLogEntry, DebugRequestEntry } from '../types/debug'

function truncateText(text: string, maxLength = 240) {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength)}...`
}

function getLatestErrorLog(logs: DebugLogEntry[]) {
  return [...logs].reverse().find((item) => item.level === 'error') || null
}

function getLatestFailedRequest(requests: DebugRequestEntry[]) {
  return [...requests].reverse().find((item) => !item.ok || item.status == null || item.status >= 400) || null
}

export function mockAnalyze(payload: AnalyzePayload) {
  const latestErrorLog = getLatestErrorLog(payload.logs)
  const latestFailedRequest = getLatestFailedRequest(payload.requests)
  const issueSummary = latestErrorLog
    ? `当前页面存在前端运行时错误，最近一次错误是：${truncateText(latestErrorLog.title || latestErrorLog.detail || '未知错误')}`
    : latestFailedRequest
      ? `当前页面最近一次异常更像是接口请求失败，目标接口为 ${truncateText(latestFailedRequest.url, 120)}`
      : '当前没有明显的致命错误，但仍建议结合最近日志继续确认业务链路是否完整。'

  const likelyReasons = [
    latestErrorLog ? `前端代码抛出了未处理异常，来源为 ${latestErrorLog.source}` : '当前没有捕获到明确的运行时错误日志。',
    latestFailedRequest
      ? latestFailedRequest.failureKind === 'business'
        ? `最近一次失败请求属于业务失败，HTTP 状态虽然是 ${latestFailedRequest.status ?? 'UNKNOWN'}，但业务码为 ${latestFailedRequest.businessCode ?? 'UNKNOWN'}，提示为 ${latestFailedRequest.businessMessage || '未知业务异常'}。`
        : `最近一次失败请求状态为 ${latestFailedRequest.status ?? 'NETWORK_ERROR'}，可能是接口地址、鉴权、参数或网络层问题。`
      : '最近请求列表里没有明显失败项，问题也可能发生在组件状态流转或静默异常处理里。',
  ]

  const checkSteps = [
    '先看面板中最后一条 error 日志和最后一条失败请求，确认哪条链路先出问题。',
    '在 DevTools Network 里复核失败请求的 URL、method、请求体和响应体是否符合预期。',
    '如果是 Promise 或异步逻辑报错，检查调用处是否缺少 try/catch 或兜底提示。',
    '如果请求返回 401/403/500，优先排查 token、跨域、网关配置和后端异常日志。',
  ]

  const fixSuggestions = [
    '为关键异步请求统一补充错误捕获和用户提示，避免错误被吞掉。',
    '对接口返回做状态码和业务码双重校验，不要直接假设请求成功。',
    '把关键上下文写入日志，例如组件名、接口参数、当前路由、用户操作步骤。',
    '如果页面依赖接口结果渲染，先补 loading、empty、error 三态，减少白屏和静默失败。',
  ]

  return [
    '## 问题判断',
    issueSummary,
    '',
    '## 可能原因',
    ...likelyReasons.map((item) => `- ${item}`),
    '',
    '## 排查步骤',
    ...checkSteps.map((item) => `- ${item}`),
    '',
    '## 修复建议',
    ...fixSuggestions.map((item) => `- ${item}`),
    '',
    '## 示例代码',
    'try {',
    '  const response = await fetch("/api/example", requestOptions)',
    '  if (!response.ok) {',
    '    throw new Error(`HTTP ${response.status}`)',
    '  }',
    '  const result = await response.json()',
    '  console.info("request success", result)',
    '} catch (error) {',
    '  console.error("request failed", error)',
    '  // TODO: 在这里补充降级 UI 或重试逻辑',
    '}',
  ].join('\n')
}
