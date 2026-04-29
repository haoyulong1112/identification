export type DebugLogLevel = 'log' | 'info' | 'warn' | 'error'
export type DebugLogSource = 'console' | 'window-error' | 'unhandledrejection'
export type DebugRequestClient = 'fetch' | 'xhr'
export type AnalyzeProvider = 'api' | 'mock'

export interface DebugPluginSettings {
  autoAnalyzeLatestError: boolean
  whitelistEnabled: boolean
  allowedDomains: string[]
}

export interface DebugAnalysisState {
  text: string
  provider: AnalyzeProvider
  usedFallback: boolean
  fallbackReason?: string
  updatedAt: string
}

export interface DebugLogEntry {
  id: string
  level: DebugLogLevel
  source: DebugLogSource
  title: string
  detail: string
  stack?: string
  time: string
}

export interface DebugRequestEntry {
  id: string
  client: DebugRequestClient
  url: string
  method: string
  status: number | null
  statusText: string
  duration: number
  requestData: string
  responseData: string
  time: string
  ok: boolean
  failureKind?: 'http' | 'network' | 'business'
  businessCode?: string | number | null
  businessMessage?: string
  errorMessage?: string
}

export interface DebugTabState {
  tabId: number
  pageUrl: string
  pageSessionId: string | null
  isReady: boolean
  pageReadyAt: string | null
  logs: DebugLogEntry[]
  requests: DebugRequestEntry[]
  latestError: string | null
  analysis: DebugAnalysisState | null
  updatedAt: string
}

export interface ActiveTabInfo {
  tabId: number
  url: string
  hostname: string
  isInjectable: boolean
  isEnabled: boolean
}

export interface AnalyzePayload {
  logs: DebugLogEntry[]
  requests: DebugRequestEntry[]
  latestError: string | null
  meta: {
    pageUrl: string
    userAgent: string
    generatedAt: string
  }
}

export interface AnalyzeApiResponse {
  code?: number
  message?: string
  error?: string
  analysis?: string
  data?: string | {
    analysis?: string
  }
}

export interface AnalyzeResult {
  text: string
  provider: AnalyzeProvider
  usedFallback: boolean
  fallbackReason?: string
}

export const DEBUG_LOG_LIMIT = 150
export const DEBUG_REQUEST_LIMIT = 80
export const DEFAULT_PLUGIN_SETTINGS: DebugPluginSettings = {
  autoAnalyzeLatestError: false,
  whitelistEnabled: false,
  allowedDomains: [],
}

export function isInjectablePageUrl(url: string) {
  return /^https?:\/\//i.test(url)
}

export function getHostnameFromUrl(url: string) {
  if (!isInjectablePageUrl(url)) {
    return ''
  }

  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function normalizeDomainList(domains: string[]) {
  return [...new Set(
    domains
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )]
}

export function isDomainEnabled(settings: DebugPluginSettings, url: string) {
  if (!settings.whitelistEnabled) {
    return true
  }

  const hostname = getHostnameFromUrl(url)

  if (!hostname) {
    return false
  }

  return settings.allowedDomains.includes(hostname)
}

export function createEmptyTabState(tabId: number, pageUrl = ''): DebugTabState {
  return {
    tabId,
    pageUrl,
    pageSessionId: null,
    isReady: false,
    pageReadyAt: null,
    logs: [],
    requests: [],
    latestError: null,
    analysis: null,
    updatedAt: new Date().toISOString(),
  }
}
