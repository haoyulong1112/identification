import { mockAnalyze } from '../shared/analyzer/mockAnalyze'
import { ANALYZE_ENDPOINT, ANALYZE_TIMEOUT_MS } from '../shared/config'
import {
  MESSAGE_TYPE,
  type ApiResponse,
  type RuntimeMessage,
} from '../shared/messaging/messages'
import {
  appendLogEntry,
  appendRequestEntry,
  getTabState,
  listTabStates,
  getPluginSettings,
  markTabReadyForSession,
  removeTabState,
  resetTabData,
  resetTabDataIfSessionUnchanged,
  setPluginSettings,
  setTabAnalysis,
} from '../shared/storage/debugStore'
import {
  createEmptyTabState,
  getHostnameFromUrl,
  isDomainEnabled,
  isInjectablePageUrl,
  type ActiveTabInfo,
  type AnalyzeApiResponse,
  type AnalyzePayload,
  type AnalyzeResult,
  type DebugLogEntry,
  type DebugPluginSettings,
  type DebugTabState,
} from '../shared/types/debug'

const AUTO_ANALYZE_COOLDOWN_MS = 5000
const lastAutoAnalyzeTimeByTab = new Map<number, number>()

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }

  return String(error)
}

async function shouldTrackUrl(url: string) {
  const settings = await getPluginSettings()

  return isInjectablePageUrl(url) && isDomainEnabled(settings, url)
}

function createAnalyzePayload(state: DebugTabState): AnalyzePayload {
  return {
    logs: state.logs,
    requests: state.requests,
    latestError: state.latestError,
    meta: {
      pageUrl: state.pageUrl,
      userAgent: navigator.userAgent,
      generatedAt: new Date().toISOString(),
    },
  }
}

function resolveApiAnalysisText(response: AnalyzeApiResponse) {
  if (typeof response.analysis === 'string' && response.analysis.trim()) {
    return response.analysis.trim()
  }

  if (typeof response.data === 'string' && response.data.trim()) {
    return response.data.trim()
  }

  if (response.data && typeof response.data === 'object' && typeof response.data.analysis === 'string') {
    return response.data.analysis.trim()
  }

  const message = response.error || response.message
  if (message) {
    throw new Error(message)
  }

  throw new Error('AI 接口返回内容中缺少分析文本')
}

async function requestRemoteAnalysis(payload: AnalyzePayload) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, ANALYZE_TIMEOUT_MS)

  try {
    const response = await fetch(ANALYZE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const rawText = await response.text()

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}${rawText ? `: ${rawText}` : ''}`)
    }

    if (!rawText.trim()) {
      throw new Error('AI 接口返回了空响应')
    }

    try {
      const result = JSON.parse(rawText) as AnalyzeApiResponse
      return resolveApiAnalysisText(result)
    } catch (error) {
      if (error instanceof SyntaxError) {
        return rawText.trim()
      }

      throw error
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`AI 接口请求超时（${ANALYZE_TIMEOUT_MS}ms）`)
    }

    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

async function analyzeState(state: DebugTabState): Promise<AnalyzeResult> {
  const payload = createAnalyzePayload(state)

  try {
    const text = await requestRemoteAnalysis(payload)
    console.log(`[ai-dev-console] analyze success via api: ${ANALYZE_ENDPOINT}`)

    return {
      text,
      provider: 'api',
      usedFallback: false,
    }
  } catch (error) {
    const fallbackReason = getErrorMessage(error)
    console.warn(`[ai-dev-console] analyze fallback to mock: ${fallbackReason}`)

    return {
      text: mockAnalyze(payload),
      provider: 'mock',
      usedFallback: true,
      fallbackReason,
    }
  }
}

async function safeSendMessage(message: RuntimeMessage) {
  try {
    await chrome.runtime.sendMessage(message)
  } catch (error) {
    const messageText = getErrorMessage(error)

    if (!messageText.includes('Receiving end does not exist')) {
      console.debug('[ai-dev-console] runtime broadcast skipped:', messageText)
    }
  }
}

function createActiveTabInfo(tab: chrome.tabs.Tab | undefined, settings: DebugPluginSettings): ActiveTabInfo {
  const url = tab?.url || ''

  return {
    tabId: typeof tab?.id === 'number' ? tab.id : -1,
    url,
    hostname: getHostnameFromUrl(url),
    isInjectable: isInjectablePageUrl(url),
    isEnabled: isInjectablePageUrl(url) && isDomainEnabled(settings, url),
  }
}

async function getActiveTabSnapshot() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  const activeTab = tabs[0]
  const settings = await getPluginSettings()
  const activeTabInfo = createActiveTabInfo(activeTab, settings)

  if (activeTabInfo.tabId < 0) {
    return {
      activeTab: activeTabInfo,
      state: createEmptyTabState(-1),
    }
  }

  return {
    activeTab: activeTabInfo,
    state: await getTabState(activeTabInfo.tabId, activeTabInfo.url),
  }
}

async function broadcastTabState(tabId: number) {
  const state = await getTabState(tabId)

  await safeSendMessage({
    type: MESSAGE_TYPE.BACKGROUND_STATE_UPDATED,
    payload: {
      tabId,
      state,
    },
  })
}

async function broadcastActiveTabChanged() {
  const { activeTab, state } = await getActiveTabSnapshot()

  await safeSendMessage({
    type: MESSAGE_TYPE.BACKGROUND_ACTIVE_TAB_CHANGED,
    payload: {
      tabId: activeTab.tabId,
      state,
    },
  })
}

async function broadcastSettingsUpdated(settings: DebugPluginSettings) {
  await safeSendMessage({
    type: MESSAGE_TYPE.BACKGROUND_SETTINGS_UPDATED,
    payload: {
      settings,
    },
  })
}

async function runAutoAnalyzeForError(tabId: number, pageUrl: string, entry: DebugLogEntry) {
  if (entry.level !== 'error') {
    return
  }

  const settings = await getPluginSettings()

  if (!settings.autoAnalyzeLatestError) {
    return
  }

  const now = Date.now()
  const lastTriggeredAt = lastAutoAnalyzeTimeByTab.get(tabId) || 0

  if (now - lastTriggeredAt < AUTO_ANALYZE_COOLDOWN_MS) {
    return
  }

  lastAutoAnalyzeTimeByTab.set(tabId, now)

  try {
    const targetState = await getTabState(tabId, pageUrl)
    const result = await analyzeState(targetState)
    await setTabAnalysis(tabId, targetState.pageUrl, result)
    await broadcastTabState(tabId)
  } catch (error) {
    console.warn('[ai-dev-console] auto analyze failed:', getErrorMessage(error))
  }
}

async function initSidePanelBehavior() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return
  }

  try {
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true,
    })
  } catch (error) {
    console.warn('[ai-dev-console] side panel behavior init failed:', getErrorMessage(error))
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void initSidePanelBehavior()
})

chrome.runtime.onStartup.addListener(() => {
  void initSidePanelBehavior()
})

chrome.tabs.onActivated.addListener(() => {
  void broadcastActiveTabChanged()
})

chrome.tabs.onRemoved.addListener((tabId) => {
  lastAutoAnalyzeTimeByTab.delete(tabId)
  void removeTabState(tabId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    void getTabState(tabId, tab.url || '').then((currentState) => {
      void resetTabDataIfSessionUnchanged(tabId, tab.url || '', currentState.pageSessionId).then(() => {
        void broadcastTabState(tabId)
      })
    })
  }

  if (changeInfo.status === 'complete') {
    void broadcastActiveTabChanged()
  }
})

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  void (async () => {
    try {
      switch (message.type) {
        case MESSAGE_TYPE.CONTENT_PAGE_READY: {
          const tabId = sender.tab?.id
          const pageUrl = message.payload.pageUrl || sender.tab?.url || ''
          const pageSessionId = message.payload.pageSessionId

          if (typeof tabId !== 'number') {
            sendResponse({
              code: 400,
              message: 'Missing sender tab id',
            } satisfies ApiResponse)
            return
          }

          if (!await shouldTrackUrl(pageUrl)) {
            sendResponse({
              code: 0,
              message: 'ignored by whitelist',
            } satisfies ApiResponse)
            return
          }

          await markTabReadyForSession(tabId, pageUrl, pageSessionId)
          await broadcastTabState(tabId)
          sendResponse({
            code: 0,
            message: 'success',
          } satisfies ApiResponse)
          return
        }

        case MESSAGE_TYPE.CONTENT_LOG_RECORDED: {
          const tabId = sender.tab?.id
          const pageUrl = message.payload.pageUrl || sender.tab?.url || ''
          const pageSessionId = message.payload.pageSessionId

          if (typeof tabId !== 'number') {
            sendResponse({
              code: 400,
              message: 'Missing sender tab id',
            } satisfies ApiResponse)
            return
          }

          if (!await shouldTrackUrl(pageUrl)) {
            sendResponse({
              code: 0,
              message: 'ignored by whitelist',
            } satisfies ApiResponse)
            return
          }

          await appendLogEntry(tabId, pageUrl, pageSessionId, message.payload.entry)
          await broadcastTabState(tabId)
          void runAutoAnalyzeForError(tabId, pageUrl, message.payload.entry)
          sendResponse({
            code: 0,
            message: 'success',
          } satisfies ApiResponse)
          return
        }

        case MESSAGE_TYPE.CONTENT_REQUEST_RECORDED: {
          const tabId = sender.tab?.id
          const pageUrl = message.payload.pageUrl || sender.tab?.url || ''
          const pageSessionId = message.payload.pageSessionId

          if (typeof tabId !== 'number') {
            sendResponse({
              code: 400,
              message: 'Missing sender tab id',
            } satisfies ApiResponse)
            return
          }

          if (!await shouldTrackUrl(pageUrl)) {
            sendResponse({
              code: 0,
              message: 'ignored by whitelist',
            } satisfies ApiResponse)
            return
          }

          await appendRequestEntry(tabId, pageUrl, pageSessionId, message.payload.entry)
          await broadcastTabState(tabId)
          sendResponse({
            code: 0,
            message: 'success',
          } satisfies ApiResponse)
          return
        }

        case MESSAGE_TYPE.PANEL_GET_ACTIVE_TAB_STATE: {
          const result = await getActiveTabSnapshot()
          sendResponse({
            code: 0,
            message: 'success',
            data: {
              tabId: result.activeTab.tabId,
              state: result.state,
            },
          } satisfies ApiResponse<{ tabId: number, state: DebugTabState }>)
          return
        }

        case MESSAGE_TYPE.PANEL_GET_PANEL_STATE: {
          const activeSnapshot = await getActiveTabSnapshot()
          const states = await listTabStates()
          const settings = await getPluginSettings()
          sendResponse({
            code: 0,
            message: 'success',
            data: {
              activeTab: activeSnapshot.activeTab,
              states,
              settings,
            },
          } satisfies ApiResponse<{
            activeTab: ActiveTabInfo
            states: DebugTabState[]
            settings: DebugPluginSettings
          }>)
          return
        }

        case MESSAGE_TYPE.PANEL_UPDATE_SETTINGS: {
          const settings = await setPluginSettings(message.payload)
          const activeSnapshot = await getActiveTabSnapshot()

          if (activeSnapshot.activeTab.tabId >= 0 && !activeSnapshot.activeTab.isEnabled) {
            await resetTabData(activeSnapshot.activeTab.tabId, activeSnapshot.activeTab.url, false)
            await broadcastTabState(activeSnapshot.activeTab.tabId)
          }

          await broadcastSettingsUpdated(settings)
          await broadcastActiveTabChanged()
          sendResponse({
            code: 0,
            message: 'success',
            data: settings,
          } satisfies ApiResponse<DebugPluginSettings>)
          return
        }

        case MESSAGE_TYPE.PANEL_CLEAR_ACTIVE_TAB_STATE: {
          const activeSnapshot = await getActiveTabSnapshot()
          const targetTabId = message.payload?.tabId ?? activeSnapshot.activeTab.tabId

          if (targetTabId < 0) {
            sendResponse({
              code: 400,
              message: 'No active tab available',
            } satisfies ApiResponse)
            return
          }

          const targetStateBeforeClear = targetTabId === activeSnapshot.activeTab.tabId
            ? activeSnapshot.state
            : await getTabState(targetTabId)
          const nextState = await resetTabData(
            targetTabId,
            targetTabId === activeSnapshot.activeTab.tabId ? activeSnapshot.activeTab.url : targetStateBeforeClear.pageUrl,
            targetStateBeforeClear.isReady,
          )
          await broadcastTabState(targetTabId)
          sendResponse({
            code: 0,
            message: 'success',
            data: {
              tabId: targetTabId,
              state: nextState,
            },
          } satisfies ApiResponse<{ tabId: number, state: DebugTabState }>)
          return
        }

        case MESSAGE_TYPE.PANEL_ANALYZE_ACTIVE_TAB: {
          const activeSnapshot = await getActiveTabSnapshot()
          const targetTabId = message.payload?.tabId ?? activeSnapshot.activeTab.tabId

          if (targetTabId < 0) {
            sendResponse({
              code: 400,
              message: 'No active tab available',
            } satisfies ApiResponse)
            return
          }

          const targetState = targetTabId === activeSnapshot.activeTab.tabId
            ? activeSnapshot.state
            : await getTabState(targetTabId)
          const result = await analyzeState(targetState)
          await setTabAnalysis(targetTabId, targetState.pageUrl, result)
          await broadcastTabState(targetTabId)
          sendResponse({
            code: 0,
            message: 'success',
            data: result,
          } satisfies ApiResponse<AnalyzeResult>)
          return
        }

        default: {
          sendResponse({
            code: 400,
            message: 'Unsupported message type',
          } satisfies ApiResponse)
        }
      }
    } catch (error) {
      sendResponse({
        code: 500,
        message: getErrorMessage(error),
      } satisfies ApiResponse)
    }
  })()

  return true
})
