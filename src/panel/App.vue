<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { DEFAULT_ANALYSIS_TEXT } from '../shared/config'
import {
  MESSAGE_TYPE,
  type ApiResponse,
  type BackgroundActiveTabChangedMessage,
  type BackgroundSettingsUpdatedMessage,
  type BackgroundStateUpdatedMessage,
  type PanelStateResponse,
  type RuntimeMessage,
} from '../shared/messaging/messages'
import {
  DEFAULT_PLUGIN_SETTINGS,
  getHostnameFromUrl,
  isDomainEnabled,
  isInjectablePageUrl,
  type ActiveTabInfo,
  createEmptyTabState,
  type AnalyzeResult,
  type DebugLogEntry,
  type DebugLogLevel,
  type DebugPluginSettings,
  type DebugRequestEntry,
  type DebugTabState,
} from '../shared/types/debug'

type MarkdownBlock = {
  key: string
  type: 'heading' | 'bullet' | 'text'
  text: string
}

type RequestStatusFilter = 'all' | 'success' | 'error'

const LOG_LEVEL_OPTIONS: Array<{ label: string, value: DebugLogLevel }> = [
  { label: 'LOG', value: 'log' },
  { label: 'INFO', value: 'info' },
  { label: 'WARN', value: 'warn' },
  { label: 'ERROR', value: 'error' },
]

const REQUEST_STATUS_OPTIONS: Array<{ label: string, value: RequestStatusFilter }> = [
  { label: '全部', value: 'all' },
  { label: '成功', value: 'success' },
  { label: '异常', value: 'error' },
]

const activeTabId = ref(-1)
const activeTabInfo = ref<ActiveTabInfo>({
  tabId: -1,
  url: '',
  hostname: '',
  isInjectable: false,
  isEnabled: false,
})
const selectedTabId = ref(-1)
const trackedStates = ref<DebugTabState[]>([])
const isLoading = ref(false)
const isAnalyzing = ref(false)
const panelErrorMessage = ref('')
const isFollowingActive = ref(true)
const pluginSettings = ref<DebugPluginSettings>({ ...DEFAULT_PLUGIN_SETTINGS })
const logSearchQuery = ref('')
const selectedLogLevels = ref<DebugLogLevel[]>(['log', 'info', 'warn', 'error'])
const requestStatusFilter = ref<RequestStatusFilter>('all')
const selectedRequestEntry = ref<DebugRequestEntry | null>(null)

const currentState = computed(() => {
  const matchedState = trackedStates.value.find((item) => item.tabId === selectedTabId.value)

  return matchedState || createEmptyTabState(selectedTabId.value)
})
const currentHostname = computed(() => activeTabInfo.value.hostname || getHostnameFromUrl(activeTabInfo.value.url))
const currentSiteEnabled = computed(() => {
  return activeTabInfo.value.isInjectable && isDomainEnabled(pluginSettings.value, activeTabInfo.value.url)
})
const displayedLogs = computed(() => {
  const keyword = logSearchQuery.value.trim().toLowerCase()

  return [...currentState.value.logs]
    .reverse()
    .filter((item) => selectedLogLevels.value.includes(item.level))
    .filter((item) => {
      if (!keyword) {
        return true
      }

      return [item.title, item.detail, item.stack || '']
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
})
const displayedRequests = computed(() => {
  return [...currentState.value.requests]
    .reverse()
    .filter((item) => {
      if (requestStatusFilter.value === 'success') {
        return !isRequestFailed(item)
      }

      if (requestStatusFilter.value === 'error') {
        return isRequestFailed(item)
      }

      return true
    })
})
const errorCount = computed(() => currentState.value.logs.filter((item) => item.level === 'error').length)
const failedRequestCount = computed(
  () => currentState.value.requests.filter((item) => isRequestFailed(item)).length,
)
const latestErrorPreview = computed(() => currentState.value.latestError || '当前没有捕获到 error 级别异常')
const latestFailedRequestPreview = computed(() => {
  const target = [...currentState.value.requests].reverse().find((item) => isRequestFailed(item))

  if (!target) {
    return '当前没有明显的失败请求'
  }

  if (target.failureKind === 'business') {
    return `${target.method} ${target.url} (${target.businessCode ?? 'BUSINESS_ERROR'}${target.businessMessage ? ` · ${target.businessMessage}` : ''})`
  }

  return `${target.method} ${target.url} (${target.status ?? 'ERR'})`
})
const currentPageText = computed(() => currentState.value.pageUrl || activeTabInfo.value.url || '当前标签页还没有可用页面上下文')
const currentAnalysis = computed(() => currentState.value.analysis)
const analysisBlocks = computed(() => parseMarkdownLike(currentAnalysis.value?.text || DEFAULT_ANALYSIS_TEXT))
const analysisActionLabel = computed(() => (isAnalyzing.value ? '分析中...' : 'AI分析当前页面'))
const autoAnalyzeLabel = computed(() => (pluginSettings.value.autoAnalyzeLatestError ? '已开启' : '已关闭'))
const whitelistLabel = computed(() => (pluginSettings.value.whitelistEnabled ? '白名单模式' : '全站模式'))
const currentDomainMembershipText = computed(() => {
  if (!currentHostname.value) {
    return '当前页面没有可用域名'
  }

  if (!pluginSettings.value.whitelistEnabled) {
    return `当前域名 ${currentHostname.value} 在全站模式下默认启用`
  }

  return currentSiteEnabled.value
    ? `当前域名 ${currentHostname.value} 已在白名单内`
    : `当前域名 ${currentHostname.value} 未加入白名单`
})
const analysisMetaText = computed(() => {
  if (!currentAnalysis.value) {
    return '尚未分析'
  }

  const segments = [currentAnalysis.value.provider === 'api' ? '真实接口' : 'Mock 回退']

  if (currentAnalysis.value.fallbackReason) {
    segments.push(`接口失败，已回退：${currentAnalysis.value.fallbackReason}`)
  }

  segments.push(`更新于 ${formatTime(currentAnalysis.value.updatedAt)}`)

  return segments.join(' · ')
})
const currentInjectionTip = computed(() => {
  if (selectedTabId.value !== activeTabInfo.value.tabId) {
    return ''
  }

  if (!activeTabInfo.value.url) {
    return '当前没有可用的标签页上下文，请切换到页面后重试。'
  }

  if (!activeTabInfo.value.isInjectable) {
    return '当前页面不是可注入的 http/https 站点，Chrome 不允许在该页面注入调试脚本。'
  }

  if (!currentSiteEnabled.value) {
    return '当前站点未被启用。你可以打开白名单模式后把当前域名加入白名单，或使用“仅在当前域名启用”。'
  }

  if (!currentState.value.isReady && currentState.value.logs.length === 0 && currentState.value.requests.length === 0) {
    return '当前站点尚未完成调试脚本注入。请刷新页面后重试；如果仍无数据，可能是页面存在 CSP、沙箱 iframe 或特殊运行环境限制。'
  }

  return ''
})
const trackedTabCards = computed(() => {
  return trackedStates.value.map((state) => {
    const stateErrorCount = state.logs.filter((item) => item.level === 'error').length
    const stateFailedRequestCount = state.requests.filter((item) => isRequestFailed(item)).length

    return {
      tabId: state.tabId,
      pageUrl: state.pageUrl || '未识别页面',
      compactLabel: createCompactSessionLabel(state.pageUrl || '未识别页面'),
      updatedAt: formatTime(state.updatedAt),
      logCount: state.logs.length,
      requestCount: state.requests.length,
      errorCount: stateErrorCount,
      failedRequestCount: stateFailedRequestCount,
      hasAnalysis: Boolean(state.analysis),
      isActive: state.tabId === activeTabId.value,
      isSelected: state.tabId === selectedTabId.value,
    }
  })
})

function applyActiveTabInfo(tabId: number, url: string) {
  const hostname = getHostnameFromUrl(url)
  const isInjectable = isInjectablePageUrl(url)

  activeTabInfo.value = {
    tabId,
    url,
    hostname,
    isInjectable,
    isEnabled: isInjectable && isDomainEnabled(pluginSettings.value, url),
  }
}

function createCompactSessionLabel(pageUrl: string) {
  if (!pageUrl || pageUrl === '未识别页面') {
    return '未识别页面'
  }

  try {
    const parsedUrl = new URL(pageUrl)
    const pathText = parsedUrl.pathname && parsedUrl.pathname !== '/' ? parsedUrl.pathname : ''
    const compactText = `${parsedUrl.hostname}${pathText}`

    if (compactText.length <= 56) {
      return compactText
    }

    return `${compactText.slice(0, 56)}...`
  } catch {
    return pageUrl.length <= 56 ? pageUrl : `${pageUrl.slice(0, 56)}...`
  }
}

function formatTime(date: string | Date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(date))
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function parseMarkdownLike(text: string): MarkdownBlock[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      if (line.startsWith('## ')) {
        return {
          key: `heading-${index}`,
          type: 'heading',
          text: line.replace('## ', '').trim(),
        }
      }

      if (line.startsWith('- ')) {
        return {
          key: `bullet-${index}`,
          type: 'bullet',
          text: line.replace('- ', '').trim(),
        }
      }

      return {
        key: `text-${index}`,
        type: 'text',
        text: line.trim(),
      }
    })
}

function formatPayload(payload: string) {
  return payload || '(empty)'
}

function isRequestFailed(entry: DebugRequestEntry) {
  return !entry.ok || entry.status == null || entry.status >= 400 || entry.failureKind === 'business'
}

function getLogTagClass(entry: DebugLogEntry) {
  return `tag-${entry.level}`
}

function getRequestStatusClass(entry: DebugRequestEntry) {
  if (isRequestFailed(entry)) {
    return 'tag-error'
  }

  return 'tag-success'
}

function getRequestStatusLabel(entry: DebugRequestEntry) {
  if (entry.failureKind === 'business') {
    return entry.businessCode != null ? `BIZ ${entry.businessCode}` : 'BIZ'
  }

  return entry.status ?? 'ERR'
}

function getRequestMetaText(entry: DebugRequestEntry) {
  const segments = [
    entry.client,
    entry.statusText || 'UNKNOWN',
    `${entry.duration}ms`,
  ]

  if (entry.failureKind === 'business' && entry.businessCode != null) {
    segments.push(`业务码 ${entry.businessCode}`)
  }

  return segments.join(' · ')
}

function getRequestFailureSummary(entry: DebugRequestEntry) {
  if (entry.failureKind === 'business') {
    const segments = ['业务异常']

    if (entry.businessCode != null) {
      segments.push(`业务码 ${entry.businessCode}`)
    }

    if (entry.businessMessage) {
      segments.push(entry.businessMessage)
    }

    return segments.join(' · ')
  }

  if (entry.errorMessage) {
    return entry.errorMessage
  }

  if (isRequestFailed(entry)) {
    return `HTTP ${entry.status ?? 'ERR'} ${entry.statusText || ''}`.trim()
  }

  return '请求成功'
}

function openRequestDetail(entry: DebugRequestEntry) {
  selectedRequestEntry.value = entry
}

function closeRequestDetail() {
  selectedRequestEntry.value = null
}

function handleDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && selectedRequestEntry.value) {
    closeRequestDetail()
  }
}

function toggleLogLevel(level: DebugLogLevel) {
  if (selectedLogLevels.value.includes(level)) {
    if (selectedLogLevels.value.length === 1) {
      return
    }

    selectedLogLevels.value = selectedLogLevels.value.filter((item) => item !== level)
    return
  }

  selectedLogLevels.value = [...selectedLogLevels.value, level]
}

function upsertTabState(nextState: DebugTabState) {
  const nextList = [...trackedStates.value]
  const matchedIndex = nextList.findIndex((item) => item.tabId === nextState.tabId)

  if (matchedIndex >= 0) {
    nextList.splice(matchedIndex, 1, nextState)
  } else {
    nextList.push(nextState)
  }

  trackedStates.value = nextList.sort((left, right) => {
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  })
}

function syncSelection() {
  if (isFollowingActive.value && activeTabId.value >= 0) {
    selectedTabId.value = activeTabId.value
    return
  }

  if (selectedTabId.value >= 0 && trackedStates.value.some((item) => item.tabId === selectedTabId.value)) {
    return
  }

  if (trackedStates.value.length > 0) {
    selectedTabId.value = trackedStates.value[0].tabId
    return
  }

  selectedTabId.value = activeTabId.value
}

async function fetchRuntimeMessage<T>(message: RuntimeMessage): Promise<ApiResponse<T>> {
  return chrome.runtime.sendMessage(message) as Promise<ApiResponse<T>>
}

async function updatePluginSettings(partialSettings: Partial<DebugPluginSettings>) {
  const response = await fetchRuntimeMessage<DebugPluginSettings>({
    type: MESSAGE_TYPE.PANEL_UPDATE_SETTINGS,
    payload: partialSettings,
  })

  if (response.code !== 0 || !response.data) {
    throw new Error(response.message || '更新插件设置失败')
  }

  pluginSettings.value = response.data
  applyActiveTabInfo(activeTabId.value, activeTabInfo.value.url)
}

async function refreshPanelState() {
  isLoading.value = true
  panelErrorMessage.value = ''

  try {
    const response = await fetchRuntimeMessage<PanelStateResponse>({
      type: MESSAGE_TYPE.PANEL_GET_PANEL_STATE,
    })

    if (response.code !== 0 || !response.data) {
      throw new Error(response.message || '获取面板状态失败')
    }

    activeTabId.value = response.data.activeTab.tabId
    pluginSettings.value = response.data.settings
    applyActiveTabInfo(response.data.activeTab.tabId, response.data.activeTab.url)
    trackedStates.value = [...response.data.states].sort((left, right) => {
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    })
    syncSelection()
  } catch (error) {
    panelErrorMessage.value = getErrorMessage(error)
  } finally {
    isLoading.value = false
  }
}

async function updateAutoAnalyzeSetting(event: Event) {
  const target = event.target as HTMLInputElement

  try {
    await updatePluginSettings({
      autoAnalyzeLatestError: target.checked,
    })
  } catch (error) {
    target.checked = pluginSettings.value.autoAnalyzeLatestError
    panelErrorMessage.value = getErrorMessage(error)
  }
}

async function updateWhitelistEnabledSetting(event: Event) {
  const target = event.target as HTMLInputElement

  try {
    await updatePluginSettings({
      whitelistEnabled: target.checked,
    })
  } catch (error) {
    target.checked = pluginSettings.value.whitelistEnabled
    panelErrorMessage.value = getErrorMessage(error)
  }
}

async function enableOnlyCurrentDomain() {
  if (!currentHostname.value) {
    return
  }

  panelErrorMessage.value = ''

  try {
    await updatePluginSettings({
      whitelistEnabled: true,
      allowedDomains: [currentHostname.value],
    })
  } catch (error) {
    panelErrorMessage.value = getErrorMessage(error)
  }
}

async function toggleCurrentDomainWhitelist() {
  if (!currentHostname.value) {
    return
  }

  panelErrorMessage.value = ''

  const exists = pluginSettings.value.allowedDomains.includes(currentHostname.value)
  const nextAllowedDomains = exists
    ? pluginSettings.value.allowedDomains.filter((item) => item !== currentHostname.value)
    : [...pluginSettings.value.allowedDomains, currentHostname.value]

  try {
    await updatePluginSettings({
      allowedDomains: nextAllowedDomains,
      whitelistEnabled: true,
    })
  } catch (error) {
    panelErrorMessage.value = getErrorMessage(error)
  }
}

async function analyzeCurrentTab() {
  isAnalyzing.value = true
  panelErrorMessage.value = ''

  try {
    const response = await fetchRuntimeMessage<AnalyzeResult>({
      type: MESSAGE_TYPE.PANEL_ANALYZE_ACTIVE_TAB,
      payload: {
        tabId: selectedTabId.value > 0 ? selectedTabId.value : undefined,
      },
    })

    if (response.code !== 0 || !response.data) {
      throw new Error(response.message || 'AI 分析失败')
    }
  } catch (error) {
    panelErrorMessage.value = getErrorMessage(error)
  } finally {
    isAnalyzing.value = false
  }
}

async function clearCurrentTabRecords() {
  panelErrorMessage.value = ''

  try {
    const response = await fetchRuntimeMessage<{ tabId: number, state: DebugTabState }>({
      type: MESSAGE_TYPE.PANEL_CLEAR_ACTIVE_TAB_STATE,
      payload: {
        tabId: selectedTabId.value > 0 ? selectedTabId.value : undefined,
      },
    })

    if (response.code !== 0 || !response.data) {
      throw new Error(response.message || '清空记录失败')
    }

    upsertTabState(response.data.state)
    syncSelection()
  } catch (error) {
    panelErrorMessage.value = getErrorMessage(error)
  }
}

function selectTab(tabId: number) {
  selectedTabId.value = tabId
  isFollowingActive.value = tabId === activeTabId.value
}

function switchBackToActive() {
  isFollowingActive.value = true
  syncSelection()
}

function createDownloadFileName() {
  const url = currentState.value.pageUrl || 'page'
  const host = (() => {
    try {
      return new URL(url).hostname || 'page'
    } catch {
      return 'page'
    }
  })()

  return `ai-dev-console-${host}-tab-${selectedTabId.value}-${Date.now()}.json`
}

function downloadTextFile(fileName: string, text: string) {
  const blob = new Blob([text], {
    type: 'application/json;charset=utf-8',
  })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}

function exportCurrentRecord() {
  panelErrorMessage.value = ''

  try {
    const payload = {
      exportedAt: new Date().toISOString(),
      activeTabId: activeTabId.value,
      selectedTabId: selectedTabId.value,
      isFollowingActive: isFollowingActive.value,
      settings: pluginSettings.value,
      state: currentState.value,
    }

    downloadTextFile(createDownloadFileName(), JSON.stringify(payload, null, 2))
  } catch (error) {
    panelErrorMessage.value = getErrorMessage(error)
  }
}

const onRuntimeMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message) => {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    return
  }

  if (message.type === MESSAGE_TYPE.BACKGROUND_STATE_UPDATED) {
    const typedMessage = message as BackgroundStateUpdatedMessage
    upsertTabState(typedMessage.payload.state)
    syncSelection()
    return
  }

  if (message.type === MESSAGE_TYPE.BACKGROUND_ACTIVE_TAB_CHANGED) {
    const typedMessage = message as BackgroundActiveTabChangedMessage
    activeTabId.value = typedMessage.payload.tabId
    applyActiveTabInfo(typedMessage.payload.tabId, typedMessage.payload.state.pageUrl)
    upsertTabState(typedMessage.payload.state)
    syncSelection()
    return
  }

  if (message.type === MESSAGE_TYPE.BACKGROUND_SETTINGS_UPDATED) {
    const typedMessage = message as BackgroundSettingsUpdatedMessage
    pluginSettings.value = typedMessage.payload.settings
    applyActiveTabInfo(activeTabId.value, activeTabInfo.value.url)
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    void refreshPanelState()
  }
}

onMounted(() => {
  chrome.runtime.onMessage.addListener(onRuntimeMessage)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  document.addEventListener('keydown', handleDocumentKeydown)
  void refreshPanelState()
})

onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(onRuntimeMessage)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  document.removeEventListener('keydown', handleDocumentKeydown)
})
</script>

<template>
  <div class="panel-shell">
    <header class="hero-card">
      <div class="hero-header">
        <div class="title-block">
          <span class="eyebrow">AI DevTools Side Panel</span>
          <h1>AI 调试控制台</h1>
          <p class="page-text">{{ currentPageText }}</p>
        </div>
        <div class="hero-badges">
          <span class="status-pill" :class="{ active: currentSiteEnabled }">
            {{ currentSiteEnabled ? '当前站点已启用' : '当前站点未启用' }}
          </span>
          <span class="status-pill subtle">{{ whitelistLabel }}</span>
        </div>
      </div>

      <div class="hero-actions">
        <button class="action action-primary" type="button" :disabled="isAnalyzing" @click="analyzeCurrentTab">
          {{ analysisActionLabel }}
        </button>
        <button class="action" type="button" @click="exportCurrentRecord">导出记录</button>
        <button class="action" type="button" @click="clearCurrentTabRecords">清空记录</button>
        <button
          v-if="selectedTabId !== activeTabId || !isFollowingActive"
          class="action"
          type="button"
          @click="switchBackToActive"
        >
          回到当前标签页
        </button>
      </div>

      <div class="settings-grid">
        <label class="toggle-card">
          <input
            class="toggle-input"
            type="checkbox"
            :checked="pluginSettings.autoAnalyzeLatestError"
            @change="updateAutoAnalyzeSetting"
          />
          <span class="toggle-track" />
          <span class="toggle-copy">
            <strong>自动分析最新错误</strong>
            <span>{{ autoAnalyzeLabel }}</span>
          </span>
        </label>

        <label class="toggle-card">
          <input
            class="toggle-input"
            type="checkbox"
            :checked="pluginSettings.whitelistEnabled"
            @change="updateWhitelistEnabledSetting"
          />
          <span class="toggle-track" />
          <span class="toggle-copy">
            <strong>站点白名单模式</strong>
            <span>{{ pluginSettings.whitelistEnabled ? '仅白名单域名生效' : '所有 http/https 站点默认生效' }}</span>
          </span>
        </label>
      </div>

      <div class="domain-actions">
        <div class="domain-info">
          <span class="eyebrow">Domain Control</span>
          <p>{{ currentDomainMembershipText }}</p>
        </div>
        <div class="domain-action-buttons">
          <button class="action" type="button" :disabled="!currentHostname" @click="enableOnlyCurrentDomain">
            仅在当前域名启用
          </button>
          <button class="action" type="button" :disabled="!currentHostname" @click="toggleCurrentDomainWhitelist">
            {{ pluginSettings.allowedDomains.includes(currentHostname) ? '移出白名单' : '加入白名单' }}
          </button>
        </div>
      </div>

      <section class="stats-card">
        <span class="stat-chip">活动标签页 {{ activeTabId > 0 ? activeTabId : '-' }}</span>
        <span class="stat-chip">当前查看 {{ selectedTabId > 0 ? selectedTabId : '-' }}</span>
        <span class="stat-chip">日志 {{ displayedLogs.length }}/{{ currentState.logs.length }}</span>
        <span class="stat-chip danger">错误 {{ errorCount }}</span>
        <span class="stat-chip">请求 {{ displayedRequests.length }}/{{ currentState.requests.length }}</span>
        <span class="stat-chip danger">异常请求 {{ failedRequestCount }}</span>
        <span class="stat-chip accent">{{ isFollowingActive ? '跟随当前标签页' : '已锁定查看会话' }}</span>
        <span class="stat-chip" v-if="isLoading">同步中...</span>
      </section>
    </header>

    <p v-if="panelErrorMessage" class="message danger-message">{{ panelErrorMessage }}</p>
    <p v-if="currentInjectionTip" class="message warning-message">{{ currentInjectionTip }}</p>

    <section class="card">
      <div class="card-header">
        <div>
          <span class="eyebrow">Tracked Tabs</span>
          <h2>会话列表</h2>
        </div>
        <span class="meta-text">已采集 {{ trackedTabCards.length }} 个标签页</span>
      </div>

      <div v-if="trackedTabCards.length > 0" class="session-list">
        <button
          v-for="item in trackedTabCards"
          :key="item.tabId"
          class="session-item"
          :class="{ active: item.isSelected, collapsed: !item.isSelected }"
          type="button"
          :aria-expanded="item.isSelected ? 'true' : 'false'"
          @click="selectTab(item.tabId)"
        >
          <div class="session-topline">
            <div class="session-title-group">
              <span class="session-id">Tab {{ item.tabId }}</span>
              <span class="session-badge" v-if="item.isActive">当前</span>
              <span class="session-badge muted" v-else-if="item.hasAnalysis">已分析</span>
            </div>
            <span class="session-toggle">{{ item.isSelected ? '已展开' : '展开' }}</span>
          </div>

          <div v-if="item.isSelected" class="session-body">
            <p class="session-url">{{ item.pageUrl }}</p>
            <p class="session-meta">
              日志 {{ item.logCount }} · 错误 {{ item.errorCount }} · 请求 {{ item.requestCount }} · 异常请求 {{ item.failedRequestCount }}
            </p>
            <p class="session-meta">最近更新 {{ item.updatedAt }}</p>
          </div>

          <div v-else class="session-body-compact">
            <p class="session-compact">{{ item.compactLabel }}</p>
            <p class="session-meta session-meta-compact">
              日志 {{ item.logCount }} · 请求 {{ item.requestCount }} · 最近更新 {{ item.updatedAt }}
            </p>
          </div>
        </button>
      </div>
      <p v-else class="empty-state">当前还没有采集到任何标签页数据。</p>
    </section>

    <section class="summary-grid">
      <article class="summary-card">
        <span class="eyebrow">Latest Error</span>
        <h3>最近错误</h3>
        <p>{{ latestErrorPreview }}</p>
      </article>

      <article class="summary-card">
        <span class="eyebrow">Failed Request</span>
        <h3>最近失败请求</h3>
        <p>{{ latestFailedRequestPreview }}</p>
      </article>

      <article class="summary-card">
        <span class="eyebrow">Analyze Status</span>
        <h3>分析状态</h3>
        <p>{{ analysisMetaText }}</p>
      </article>
    </section>

    <section class="card">
      <div class="card-header">
        <div>
          <span class="eyebrow">AI Analyze</span>
          <h2>分析结果</h2>
        </div>
        <span class="meta-text">{{ analysisMetaText }}</span>
      </div>

      <div class="analysis-body">
        <template v-for="block in analysisBlocks" :key="block.key">
          <h3 v-if="block.type === 'heading'" class="analysis-heading">{{ block.text }}</h3>
          <p v-else-if="block.type === 'bullet'" class="analysis-bullet">{{ block.text }}</p>
          <p v-else class="analysis-text">{{ block.text }}</p>
        </template>
      </div>
    </section>

    <section class="card">
      <div class="card-header">
        <div>
          <span class="eyebrow">Console</span>
          <h2>日志列表</h2>
        </div>
        <span class="meta-text">显示 {{ displayedLogs.length }} / {{ currentState.logs.length }}</span>
      </div>

      <div class="toolbar-grid">
        <label class="search-box">
          <span>搜索日志</span>
          <input v-model="logSearchQuery" type="text" placeholder="按标题、详情、堆栈搜索" />
        </label>

        <div class="filter-group">
          <span class="filter-label">日志级别</span>
          <div class="filter-chips">
            <button
              v-for="option in LOG_LEVEL_OPTIONS"
              :key="option.value"
              class="chip-button"
              :class="{ active: selectedLogLevels.includes(option.value) }"
              type="button"
              @click="toggleLogLevel(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="displayedLogs.length > 0" class="list">
        <article v-for="entry in displayedLogs" :key="entry.id" class="list-item">
          <div class="item-header">
            <span class="tag" :class="getLogTagClass(entry)">{{ entry.level }}</span>
            <span class="item-title">{{ entry.title }}</span>
            <span class="item-time">{{ entry.time }}</span>
          </div>
          <p class="item-detail">{{ entry.detail }}</p>
          <p v-if="entry.stack" class="item-stack">{{ entry.stack }}</p>
        </article>
      </div>
      <p v-else class="empty-state">当前筛选条件下没有日志结果。</p>
    </section>

    <section class="card">
      <div class="card-header">
        <div>
          <span class="eyebrow">Network</span>
          <h2>请求列表</h2>
        </div>
        <span class="meta-text">显示 {{ displayedRequests.length }} / {{ currentState.requests.length }}</span>
      </div>

      <div class="toolbar-grid">
        <div class="filter-group">
          <span class="filter-label">请求状态</span>
          <div class="filter-chips">
            <button
              v-for="option in REQUEST_STATUS_OPTIONS"
              :key="option.value"
              class="chip-button"
              :class="{ active: requestStatusFilter === option.value }"
              type="button"
              @click="requestStatusFilter = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="displayedRequests.length > 0" class="list">
        <article
          v-for="entry in displayedRequests"
          :key="entry.id"
          class="list-item request-list-item"
          role="button"
          tabindex="0"
          @click="openRequestDetail(entry)"
          @keydown.enter.prevent="openRequestDetail(entry)"
          @keydown.space.prevent="openRequestDetail(entry)"
        >
          <div class="item-header">
            <span class="tag" :class="getRequestStatusClass(entry)">{{ getRequestStatusLabel(entry) }}</span>
            <span class="item-title request-item-title">{{ entry.method }} {{ entry.url }}</span>
            <span class="item-time">{{ entry.time }}</span>
          </div>
          <p class="item-detail request-text-clamp">{{ getRequestMetaText(entry) }}</p>
          <p class="item-code request-text-clamp">request: {{ formatPayload(entry.requestData) }}</p>
          <p class="item-code request-text-clamp">response: {{ formatPayload(entry.responseData) }}</p>
          <p v-if="entry.businessMessage" class="item-stack request-text-clamp">业务异常: {{ entry.businessMessage }}</p>
          <p v-if="entry.errorMessage && entry.errorMessage !== entry.businessMessage" class="item-stack request-text-clamp">
            {{ entry.errorMessage }}
          </p>
        </article>
      </div>
      <p v-else class="empty-state">当前筛选条件下没有请求结果。</p>
    </section>

    <div v-if="selectedRequestEntry" class="request-modal-backdrop" @click.self="closeRequestDetail">
      <section class="request-modal">
        <div class="request-modal-header">
          <div>
            <span class="eyebrow">Request Detail</span>
            <h3 class="request-modal-title">{{ selectedRequestEntry.method }} {{ selectedRequestEntry.url }}</h3>
            <p class="request-modal-meta">
              {{ getRequestStatusLabel(selectedRequestEntry) }} · {{ getRequestMetaText(selectedRequestEntry) }}
            </p>
          </div>
          <button class="action" type="button" @click="closeRequestDetail">关闭</button>
        </div>

        <div class="request-modal-summary">
          <span class="stat-chip">时间 {{ selectedRequestEntry.time }}</span>
          <span class="stat-chip">客户端 {{ selectedRequestEntry.client }}</span>
          <span class="stat-chip" :class="{ danger: isRequestFailed(selectedRequestEntry) }">
            {{ getRequestFailureSummary(selectedRequestEntry) }}
          </span>
        </div>

        <div class="request-modal-body">
          <div class="request-detail-block">
            <span class="eyebrow">Request</span>
            <pre class="request-detail-pre">{{ formatPayload(selectedRequestEntry.requestData) }}</pre>
          </div>

          <div class="request-detail-block">
            <span class="eyebrow">Response</span>
            <pre class="request-detail-pre">{{ formatPayload(selectedRequestEntry.responseData) }}</pre>
          </div>

          <div
            v-if="selectedRequestEntry.businessMessage || selectedRequestEntry.errorMessage"
            class="request-detail-block"
          >
            <span class="eyebrow">Failure Detail</span>
            <pre class="request-detail-pre">{{ [
              selectedRequestEntry.businessMessage ? `业务异常: ${selectedRequestEntry.businessMessage}` : '',
              selectedRequestEntry.errorMessage && selectedRequestEntry.errorMessage !== selectedRequestEntry.businessMessage
                ? selectedRequestEntry.errorMessage
                : '',
            ].filter(Boolean).join('\n') }}</pre>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
