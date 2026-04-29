import {
  DEFAULT_PLUGIN_SETTINGS,
  DEBUG_LOG_LIMIT,
  DEBUG_REQUEST_LIMIT,
  createEmptyTabState,
  normalizeDomainList,
  type AnalyzeResult,
  type DebugPluginSettings,
  type DebugLogEntry,
  type DebugRequestEntry,
  type DebugTabState,
} from '../types/debug'

const TAB_STATE_STORAGE_KEY = 'ai-dev-console:tab-state'
const SETTINGS_STORAGE_KEY = 'ai-dev-console:settings'

type DebugStateMap = Record<string, DebugTabState>

async function readStateMap(): Promise<DebugStateMap> {
  const result = await chrome.storage.local.get(TAB_STATE_STORAGE_KEY)
  const rawValue = result[TAB_STATE_STORAGE_KEY]

  if (!rawValue || typeof rawValue !== 'object') {
    return {}
  }

  return rawValue as DebugStateMap
}

async function writeStateMap(stateMap: DebugStateMap) {
  await chrome.storage.local.set({
    [TAB_STATE_STORAGE_KEY]: stateMap,
  })
}

function normalizeSettings(rawValue: unknown): DebugPluginSettings {
  if (!rawValue || typeof rawValue !== 'object') {
    return DEFAULT_PLUGIN_SETTINGS
  }

  return {
    autoAnalyzeLatestError:
      typeof (rawValue as DebugPluginSettings).autoAnalyzeLatestError === 'boolean'
        ? (rawValue as DebugPluginSettings).autoAnalyzeLatestError
        : DEFAULT_PLUGIN_SETTINGS.autoAnalyzeLatestError,
    whitelistEnabled:
      typeof (rawValue as DebugPluginSettings).whitelistEnabled === 'boolean'
        ? (rawValue as DebugPluginSettings).whitelistEnabled
        : DEFAULT_PLUGIN_SETTINGS.whitelistEnabled,
    allowedDomains: Array.isArray((rawValue as DebugPluginSettings).allowedDomains)
      ? normalizeDomainList((rawValue as DebugPluginSettings).allowedDomains)
      : DEFAULT_PLUGIN_SETTINGS.allowedDomains,
  }
}

export async function getPluginSettings() {
  const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY)

  return normalizeSettings(result[SETTINGS_STORAGE_KEY])
}

export async function setPluginSettings(partialSettings: Partial<DebugPluginSettings>) {
  const currentSettings = await getPluginSettings()
  const nextSettings: DebugPluginSettings = {
    ...currentSettings,
    ...partialSettings,
  }
  nextSettings.allowedDomains = normalizeDomainList(nextSettings.allowedDomains)

  await chrome.storage.local.set({
    [SETTINGS_STORAGE_KEY]: nextSettings,
  })

  return nextSettings
}

export async function getTabState(tabId: number, pageUrl = '') {
  const stateMap = await readStateMap()

  return stateMap[String(tabId)] || createEmptyTabState(tabId, pageUrl)
}

export async function listTabStates() {
  const stateMap = await readStateMap()

  return Object.values(stateMap).sort((left, right) => {
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  })
}

export async function setTabState(nextState: DebugTabState) {
  const stateMap = await readStateMap()
  stateMap[String(nextState.tabId)] = nextState
  await writeStateMap(stateMap)

  return nextState
}

export async function syncTabPage(tabId: number, pageUrl = '') {
  const currentState = await getTabState(tabId, pageUrl)
  currentState.pageUrl = pageUrl || currentState.pageUrl
  currentState.updatedAt = new Date().toISOString()

  return setTabState(currentState)
}

export async function markTabReady(tabId: number, pageUrl = '') {
  const currentState = await getTabState(tabId, pageUrl)
  const now = new Date().toISOString()

  currentState.pageUrl = pageUrl || currentState.pageUrl
  currentState.isReady = true
  currentState.pageReadyAt = now
  currentState.updatedAt = now

  return setTabState(currentState)
}

async function getPreparedTabState(tabId: number, pageUrl: string, pageSessionId: string) {
  const currentState = await getTabState(tabId, pageUrl)

  if (currentState.pageSessionId && currentState.pageSessionId !== pageSessionId) {
    const nextState = createEmptyTabState(tabId, pageUrl || currentState.pageUrl)
    nextState.pageSessionId = pageSessionId
    return nextState
  }

  currentState.pageSessionId = pageSessionId

  return currentState
}

export async function markTabReadyForSession(tabId: number, pageUrl: string, pageSessionId: string) {
  const currentState = await getPreparedTabState(tabId, pageUrl, pageSessionId)
  const now = new Date().toISOString()

  currentState.pageUrl = pageUrl || currentState.pageUrl
  currentState.pageSessionId = pageSessionId
  currentState.isReady = true
  currentState.pageReadyAt = now
  currentState.updatedAt = now

  return setTabState(currentState)
}

export async function appendLogEntry(tabId: number, pageUrl: string, pageSessionId: string, entry: DebugLogEntry) {
  const currentState = await getPreparedTabState(tabId, pageUrl, pageSessionId)
  const now = new Date().toISOString()
  currentState.pageUrl = pageUrl || currentState.pageUrl
  currentState.pageSessionId = pageSessionId
  currentState.isReady = true
  currentState.pageReadyAt = currentState.pageReadyAt || now

  if (!currentState.logs.some((item) => item.id === entry.id)) {
    currentState.logs = [...currentState.logs, entry].slice(-DEBUG_LOG_LIMIT)
  }

  currentState.updatedAt = now

  if (entry.level === 'error') {
    currentState.latestError = entry.title || entry.detail || currentState.latestError
  }

  return setTabState(currentState)
}

export async function appendRequestEntry(tabId: number, pageUrl: string, pageSessionId: string, entry: DebugRequestEntry) {
  const currentState = await getPreparedTabState(tabId, pageUrl, pageSessionId)
  const now = new Date().toISOString()
  currentState.pageUrl = pageUrl || currentState.pageUrl
  currentState.pageSessionId = pageSessionId
  currentState.isReady = true
  currentState.pageReadyAt = currentState.pageReadyAt || now

  if (!currentState.requests.some((item) => item.id === entry.id)) {
    currentState.requests = [...currentState.requests, entry].slice(-DEBUG_REQUEST_LIMIT)
  }

  currentState.updatedAt = now

  return setTabState(currentState)
}

export async function clearTabState(tabId: number, pageUrl = '') {
  const emptyState = createEmptyTabState(tabId, pageUrl)
  await setTabState(emptyState)

  return emptyState
}

export async function resetTabData(
  tabId: number,
  pageUrl = '',
  preserveReadyState = false,
) {
  const previousState = await getTabState(tabId, pageUrl)
  const nextState = createEmptyTabState(tabId, pageUrl || previousState.pageUrl)

  if (preserveReadyState) {
    nextState.isReady = previousState.isReady
    nextState.pageReadyAt = previousState.pageReadyAt
  }

  await setTabState(nextState)

  return nextState
}

export async function resetTabDataIfSessionUnchanged(
  tabId: number,
  pageUrl = '',
  expectedPageSessionId: string | null,
) {
  const currentState = await getTabState(tabId, pageUrl)

  if (currentState.pageSessionId !== expectedPageSessionId) {
    return currentState
  }

  return resetTabData(tabId, pageUrl, false)
}

export async function setTabAnalysis(tabId: number, pageUrl: string, result: AnalyzeResult) {
  const currentState = await getTabState(tabId, pageUrl)
  currentState.pageUrl = pageUrl || currentState.pageUrl
  currentState.analysis = {
    ...result,
    updatedAt: new Date().toISOString(),
  }
  currentState.updatedAt = currentState.analysis.updatedAt

  return setTabState(currentState)
}

export async function removeTabState(tabId: number) {
  const stateMap = await readStateMap()
  delete stateMap[String(tabId)]
  await writeStateMap(stateMap)
}
