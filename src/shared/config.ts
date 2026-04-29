export const ANALYZE_ENDPOINT =
  import.meta.env.VITE_AI_ANALYZE_ENDPOINT || 'https://api.haoyl2025.cn/api/ai/analyze'

export const ANALYZE_TIMEOUT_MS = 30000

export const DEFAULT_ANALYSIS_TEXT =
  '点击“AI分析当前页面”后，会把当前标签页采集到的日志、异常和请求记录发给后端分析；接口不可用时会自动回退到本地 mock 结果。'
