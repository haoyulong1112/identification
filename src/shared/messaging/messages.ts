import type {
  ActiveTabInfo,
  DebugPluginSettings,
  DebugLogEntry,
  DebugRequestEntry,
  DebugTabState,
} from '../types/debug'

export const MESSAGE_TYPE = {
  CONTENT_PAGE_READY: 'CONTENT_PAGE_READY',
  CONTENT_LOG_RECORDED: 'CONTENT_LOG_RECORDED',
  CONTENT_REQUEST_RECORDED: 'CONTENT_REQUEST_RECORDED',
  PANEL_GET_PANEL_STATE: 'PANEL_GET_PANEL_STATE',
  PANEL_GET_ACTIVE_TAB_STATE: 'PANEL_GET_ACTIVE_TAB_STATE',
  PANEL_CLEAR_ACTIVE_TAB_STATE: 'PANEL_CLEAR_ACTIVE_TAB_STATE',
  PANEL_ANALYZE_ACTIVE_TAB: 'PANEL_ANALYZE_ACTIVE_TAB',
  PANEL_UPDATE_SETTINGS: 'PANEL_UPDATE_SETTINGS',
  BACKGROUND_STATE_UPDATED: 'BACKGROUND_STATE_UPDATED',
  BACKGROUND_ACTIVE_TAB_CHANGED: 'BACKGROUND_ACTIVE_TAB_CHANGED',
  BACKGROUND_SETTINGS_UPDATED: 'BACKGROUND_SETTINGS_UPDATED',
} as const

export const PAGE_HOOK_SOURCE = 'AI_DEV_CONSOLE_PAGE'

export const PAGE_HOOK_MESSAGE_TYPE = {
  READY: 'PAGE_READY',
  LOG_RECORDED: 'PAGE_LOG_RECORDED',
  REQUEST_RECORDED: 'PAGE_REQUEST_RECORDED',
  SYNC_REQUEST: 'PAGE_SYNC_REQUEST',
} as const

export interface ApiResponse<T = undefined> {
  code: number
  message: string
  data?: T
}

export interface ContentPageReadyMessage {
  type: typeof MESSAGE_TYPE.CONTENT_PAGE_READY
  payload: {
    pageUrl: string
    userAgent: string
    pageSessionId: string
  }
}

export interface ContentLogRecordedMessage {
  type: typeof MESSAGE_TYPE.CONTENT_LOG_RECORDED
  payload: {
    pageUrl: string
    pageSessionId: string
    entry: DebugLogEntry
  }
}

export interface ContentRequestRecordedMessage {
  type: typeof MESSAGE_TYPE.CONTENT_REQUEST_RECORDED
  payload: {
    pageUrl: string
    pageSessionId: string
    entry: DebugRequestEntry
  }
}

export interface PanelGetPanelStateMessage {
  type: typeof MESSAGE_TYPE.PANEL_GET_PANEL_STATE
}

export interface PanelGetActiveTabStateMessage {
  type: typeof MESSAGE_TYPE.PANEL_GET_ACTIVE_TAB_STATE
}

export interface PanelUpdateSettingsMessage {
  type: typeof MESSAGE_TYPE.PANEL_UPDATE_SETTINGS
  payload: Partial<DebugPluginSettings>
}

export interface PanelClearActiveTabStateMessage {
  type: typeof MESSAGE_TYPE.PANEL_CLEAR_ACTIVE_TAB_STATE
  payload?: {
    tabId?: number
  }
}

export interface PanelAnalyzeActiveTabMessage {
  type: typeof MESSAGE_TYPE.PANEL_ANALYZE_ACTIVE_TAB
  payload?: {
    tabId?: number
  }
}

export interface BackgroundStateUpdatedMessage {
  type: typeof MESSAGE_TYPE.BACKGROUND_STATE_UPDATED
  payload: {
    tabId: number
    state: DebugTabState
  }
}

export interface BackgroundActiveTabChangedMessage {
  type: typeof MESSAGE_TYPE.BACKGROUND_ACTIVE_TAB_CHANGED
  payload: {
    tabId: number
    state: DebugTabState
  }
}

export interface BackgroundSettingsUpdatedMessage {
  type: typeof MESSAGE_TYPE.BACKGROUND_SETTINGS_UPDATED
  payload: {
    settings: DebugPluginSettings
  }
}

export interface PanelStateResponse {
  activeTab: ActiveTabInfo
  states: DebugTabState[]
  settings: DebugPluginSettings
}

export type RuntimeMessage =
  | ContentPageReadyMessage
  | ContentLogRecordedMessage
  | ContentRequestRecordedMessage
  | PanelGetPanelStateMessage
  | PanelGetActiveTabStateMessage
  | PanelUpdateSettingsMessage
  | PanelClearActiveTabStateMessage
  | PanelAnalyzeActiveTabMessage
  | BackgroundStateUpdatedMessage
  | BackgroundActiveTabChangedMessage
  | BackgroundSettingsUpdatedMessage

export interface PageReadyHookMessage {
  source: typeof PAGE_HOOK_SOURCE
  type: typeof PAGE_HOOK_MESSAGE_TYPE.READY
  payload: {
    pageUrl: string
    userAgent: string
    pageSessionId: string
  }
}

export interface PageLogHookMessage {
  source: typeof PAGE_HOOK_SOURCE
  type: typeof PAGE_HOOK_MESSAGE_TYPE.LOG_RECORDED
  payload: {
    pageUrl: string
    pageSessionId: string
    entry: DebugLogEntry
  }
}

export interface PageRequestHookMessage {
  source: typeof PAGE_HOOK_SOURCE
  type: typeof PAGE_HOOK_MESSAGE_TYPE.REQUEST_RECORDED
  payload: {
    pageUrl: string
    pageSessionId: string
    entry: DebugRequestEntry
  }
}

export interface PageSyncRequestHookMessage {
  source: typeof PAGE_HOOK_SOURCE
  type: typeof PAGE_HOOK_MESSAGE_TYPE.SYNC_REQUEST
  payload: {
    requestedAt: number
  }
}

export type PageHookMessage =
  | PageReadyHookMessage
  | PageLogHookMessage
  | PageRequestHookMessage
  | PageSyncRequestHookMessage
