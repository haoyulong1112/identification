import {
  PAGE_HOOK_MESSAGE_TYPE,
  PAGE_HOOK_SOURCE,
  type PageHookMessage,
  type PageLogHookMessage,
  type PageReadyHookMessage,
  type PageRequestHookMessage,
} from '../shared/messaging/messages'
import type {
  DebugLogEntry,
  DebugLogLevel,
  DebugLogSource,
  DebugRequestEntry,
} from '../shared/types/debug'

declare global {
  interface Window {
    __AI_DEV_CONSOLE_HOOKED__?: boolean
  }

  interface XMLHttpRequest {
    __AI_DEV_CONSOLE_META__?: {
      method: string
      url: string
      startedAt: number
      requestData: string
    }
  }
}

const MAX_LOG_DETAIL_LENGTH = 1400
const MAX_REQUEST_PAYLOAD_LENGTH = 20000
const MAX_BUFFERED_MESSAGES = 120

type BufferedPageHookMessage =
  | PageReadyHookMessage
  | PageLogHookMessage
  | PageRequestHookMessage

function isPageHookMessage(value: unknown): value is PageHookMessage {
  return Boolean(
    value
    && typeof value === 'object'
    && 'source' in value
    && 'type' in value
    && (value as { source?: string }).source === PAGE_HOOK_SOURCE,
  )
}

if (!window.__AI_DEV_CONSOLE_HOOKED__) {
  window.__AI_DEV_CONSOLE_HOOKED__ = true
  const pageSessionId = `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const bufferedMessages: BufferedPageHookMessage[] = []

  const originalConsole = {
    log: window.console.log,
    info: window.console.info,
    warn: window.console.warn,
    error: window.console.error,
  }

  function createId(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  function formatTime() {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false })
  }

  function truncateText(text: string, maxLength = MAX_LOG_DETAIL_LENGTH) {
    if (text.length <= maxLength) {
      return text
    }

    return `${text.slice(0, maxLength)}...`
  }

  function truncatePayloadText(text: string, maxLength = MAX_REQUEST_PAYLOAD_LENGTH) {
    if (text.length <= maxLength) {
      return text
    }

    return `${text.slice(0, maxLength)}...[truncated]`
  }

  function safeSerialize(value: unknown, maxLength = MAX_LOG_DETAIL_LENGTH) {
    if (typeof value === 'string') {
      return truncateText(value, maxLength)
    }

    if (value instanceof Error) {
      return truncateText(`${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`, maxLength)
    }

    if (typeof value === 'undefined') {
      return 'undefined'
    }

    if (typeof value === 'function') {
      return `[Function ${value.name || 'anonymous'}]`
    }

    if (typeof value === 'symbol') {
      return value.toString()
    }

    const seen = new WeakSet()

    try {
      return truncateText(JSON.stringify(value, (_key, currentValue) => {
        if (currentValue && typeof currentValue === 'object') {
          if (seen.has(currentValue)) {
            return '[Circular]'
          }

          seen.add(currentValue)
        }

        return currentValue
      }, 2), maxLength)
    } catch {
      return truncateText(String(value), maxLength)
    }
  }

  function safeSerializeRaw(value: unknown) {
    if (typeof value === 'string') {
      return value
    }

    if (value instanceof Error) {
      return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`
    }

    if (typeof value === 'undefined') {
      return 'undefined'
    }

    if (typeof value === 'function') {
      return `[Function ${value.name || 'anonymous'}]`
    }

    if (typeof value === 'symbol') {
      return value.toString()
    }

    const seen = new WeakSet()

    try {
      return JSON.stringify(value, (_key, currentValue) => {
        if (currentValue && typeof currentValue === 'object') {
          if (seen.has(currentValue)) {
            return '[Circular]'
          }

          seen.add(currentValue)
        }

        return currentValue
      }, 2)
    } catch {
      return String(value)
    }
  }

  function serializeArgs(args: unknown[]) {
    return truncateText(args.map((item) => safeSerialize(item)).join(' '))
  }

  function normalizeConsoleLevel(level: DebugLogLevel, args: unknown[]) {
    if (level === 'warn') {
      const text = args.map((item) => safeSerialize(item)).join(' ').toLowerCase()

      if (
        text.includes('unhandled error')
        || text.includes('uncaught ')
        || text.includes('typeerror')
        || text.includes('referenceerror')
        || text.includes('syntaxerror')
      ) {
        return 'error'
      }
    }

    return level
  }

  function getObjectRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }

    return value as Record<string, unknown>
  }

  function getPrimitiveText(value: unknown) {
    if (typeof value === 'string') {
      return value.trim()
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }

    return ''
  }

  function normalizeBusinessCode(value: unknown) {
    if (typeof value === 'string' || typeof value === 'number') {
      return value
    }

    return null
  }

  function isSuccessBusinessCode(value: string) {
    const normalizedValue = value.trim().toLowerCase()

    if (!normalizedValue) {
      return false
    }

    if (/^0+$/.test(normalizedValue)) {
      return true
    }

    if (['200', '20000', 'ok', 'success', 'true'].includes(normalizedValue)) {
      return true
    }

    return false
  }

  function parseJsonSafely(text: string) {
    const trimmedText = text.trim()

    if (!trimmedText || (!trimmedText.startsWith('{') && !trimmedText.startsWith('['))) {
      return null
    }

    try {
      return JSON.parse(trimmedText) as unknown
    } catch {
      return null
    }
  }

  function extractBusinessFailure(payload: unknown) {
    const record = getObjectRecord(payload)

    if (!record) {
      return {
        isBusinessError: false,
        businessCode: null,
        businessMessage: '',
      }
    }

    const businessCode = normalizeBusinessCode(
      record.code ?? record.errCode ?? record.errcode ?? record.errorCode ?? record.errno,
    )
    const businessMessage = getPrimitiveText(
      record.message ?? record.msg ?? record.error ?? record.errMsg ?? record.errmsg ?? record.detail,
    )
    const successFlag = record.success ?? record.ok

    if (typeof successFlag === 'boolean' && successFlag === false) {
      return {
        isBusinessError: true,
        businessCode,
        businessMessage: businessMessage || '业务返回失败',
      }
    }

    if (typeof successFlag === 'boolean' && successFlag === true) {
      return {
        isBusinessError: false,
        businessCode: null,
        businessMessage: '',
      }
    }

    if (businessCode !== null) {
      const normalizedCode = String(businessCode).trim()

      if (isSuccessBusinessCode(normalizedCode)) {
        return {
          isBusinessError: false,
          businessCode: null,
          businessMessage: '',
        }
      }

      if (normalizedCode) {
        return {
          isBusinessError: true,
          businessCode,
          businessMessage: businessMessage || `业务码 ${businessCode}`,
        }
      }
    }

    const statusText = getPrimitiveText(record.status).toLowerCase()

    if (statusText && /fail|error|invalid|exception/.test(statusText) && !/success|ok/.test(statusText)) {
      return {
        isBusinessError: true,
        businessCode,
        businessMessage: businessMessage || statusText,
      }
    }

    return {
      isBusinessError: false,
      businessCode: null,
      businessMessage: '',
    }
  }

  function buildRequestDiagnostics(
    status: number | null,
    statusText: string,
    responsePayload: unknown,
    transportError = '',
  ) {
    if (transportError) {
      return {
        ok: false,
        failureKind: 'network' as const,
        businessCode: null,
        businessMessage: '',
        errorMessage: transportError,
      }
    }

    const businessFailure = extractBusinessFailure(
      typeof responsePayload === 'string' ? parseJsonSafely(responsePayload) : responsePayload,
    )

    if (businessFailure.isBusinessError) {
      return {
        ok: false,
        failureKind: 'business' as const,
        businessCode: businessFailure.businessCode,
        businessMessage: businessFailure.businessMessage,
        errorMessage: businessFailure.businessMessage || (
          businessFailure.businessCode !== null ? `业务码 ${businessFailure.businessCode}` : '业务请求失败'
        ),
      }
    }

    const isHttpOk = status != null && status >= 200 && status < 400

    if (!isHttpOk) {
      return {
        ok: false,
        failureKind: status == null ? 'network' as const : 'http' as const,
        businessCode: null,
        businessMessage: '',
        errorMessage: status == null ? '请求失败或被阻止' : `HTTP ${status}${statusText ? ` ${statusText}` : ''}`,
      }
    }

    return {
      ok: true,
      failureKind: undefined,
      businessCode: null,
      businessMessage: '',
      errorMessage: '',
    }
  }

  function readXHRResponsePayload(xhr: XMLHttpRequest) {
    const responseType = xhr.responseType || ''

    try {
      if (!responseType || responseType === 'text') {
        const rawText = typeof xhr.responseText === 'string' ? xhr.responseText : (
          typeof xhr.response === 'string' ? xhr.response : ''
        )

        return {
          rawResponsePayload: rawText,
          responseData: rawText ? truncatePayloadText(rawText) : '[xhr response unavailable]',
        }
      }

      if (responseType === 'json') {
        const rawJson = safeSerializeRaw(xhr.response)

        return {
          rawResponsePayload: xhr.response,
          responseData: rawJson ? truncatePayloadText(rawJson) : '[xhr response unavailable]',
        }
      }

      if (typeof xhr.response === 'string') {
        return {
          rawResponsePayload: xhr.response,
          responseData: truncatePayloadText(xhr.response),
        }
      }

      const rawValue = safeSerializeRaw(xhr.response)

      return {
        rawResponsePayload: xhr.response,
        responseData: rawValue ? truncatePayloadText(rawValue) : '[xhr response unavailable]',
      }
    } catch {
      return {
        rawResponsePayload: xhr.response ?? '',
        responseData: '[xhr response unavailable]',
      }
    }
  }

  function describeUnhandledRejection(reason: unknown) {
    if (reason instanceof Error) {
      return {
        title: reason.message || 'Unhandled promise rejection',
        detail: safeSerialize(reason),
        stack: reason.stack || '',
      }
    }

    const reasonRecord = getObjectRecord(reason)

    if (!reasonRecord) {
      return {
        title: 'Unhandled promise rejection',
        detail: safeSerialize(reason),
        stack: '',
      }
    }

    const responseRecord = getObjectRecord(reasonRecord.response) || reasonRecord
    const dataRecord = getObjectRecord(responseRecord.data) || getObjectRecord(reasonRecord.data)
    const configRecord = getObjectRecord(reasonRecord.config)
    const businessCode = normalizeBusinessCode(
      dataRecord?.code ?? dataRecord?.errCode ?? dataRecord?.errcode ?? dataRecord?.errorCode ?? dataRecord?.errno ?? reasonRecord.code,
    )
    const businessMessage = getPrimitiveText(
      dataRecord?.message ?? dataRecord?.msg ?? reasonRecord.message ?? reasonRecord.error ?? responseRecord.statusText,
    )
    const statusValue = responseRecord.status ?? reasonRecord.status
    const status = typeof statusValue === 'number' ? statusValue : null
    const method = getPrimitiveText(configRecord?.method ?? reasonRecord.method).toUpperCase()
    const url = getPrimitiveText(configRecord?.url ?? responseRecord.url ?? reasonRecord.url)
    const detailParts = [
      [method, url].filter(Boolean).join(' '),
      status != null ? `status ${status}` : '',
      businessCode !== null ? `code ${businessCode}` : '',
      businessMessage,
    ].filter(Boolean)

    return {
      title: businessMessage || 'Unhandled promise rejection',
      detail: detailParts.join(' · ') || safeSerialize(reason),
      stack: '',
    }
  }

  function dispatchBufferedMessage(message: BufferedPageHookMessage) {
    bufferedMessages.push(message)

    if (bufferedMessages.length > MAX_BUFFERED_MESSAGES) {
      bufferedMessages.shift()
    }

    window.postMessage(message, '*')
  }

  function replayBufferedMessages() {
    bufferedMessages.forEach((message) => {
      window.postMessage(message, '*')
    })
  }

  function postToContentScript<T extends BufferedPageHookMessage['type']>(
    type: T,
    payload: Extract<BufferedPageHookMessage, { type: T }>['payload'],
  ) {
    dispatchBufferedMessage({
      source: PAGE_HOOK_SOURCE,
      type,
      payload,
    } as Extract<BufferedPageHookMessage, { type: T }>)
  }

  function recordLog(level: DebugLogLevel, source: DebugLogSource, args: unknown[], extra?: Partial<DebugLogEntry>) {
    const normalizedLevel = source === 'console' ? normalizeConsoleLevel(level, args) : level
    const title = args.length > 0 ? safeSerialize(args[0]) : `${source} message`
    const detail = serializeArgs(args)

    postToContentScript(PAGE_HOOK_MESSAGE_TYPE.LOG_RECORDED, {
      pageUrl: window.location.href,
      pageSessionId,
      entry: {
        id: createId('log'),
        level: normalizedLevel,
        source,
        title,
        detail,
        stack: extra?.stack || '',
        time: formatTime(),
      } satisfies DebugLogEntry,
    })
  }

  function recordRequest(entry: DebugRequestEntry) {
    postToContentScript(PAGE_HOOK_MESSAGE_TYPE.REQUEST_RECORDED, {
      pageUrl: window.location.href,
      pageSessionId,
      entry,
    })
  }

  function emitReadySignal() {
    postToContentScript(PAGE_HOOK_MESSAGE_TYPE.READY, {
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
      pageSessionId,
    })
  }

  // READY 偶尔会因为主世界脚本和桥接脚本注入时序导致首帧丢失，这里补发两次降低漏报概率。
  emitReadySignal()
  window.setTimeout(emitReadySignal, 0)
  window.addEventListener('load', emitReadySignal, { once: true })
  window.addEventListener('message', (event: MessageEvent<PageHookMessage>) => {
    const message = event.data

    if (!isPageHookMessage(message)) {
      return
    }

    if (message.type === PAGE_HOOK_MESSAGE_TYPE.SYNC_REQUEST) {
      replayBufferedMessages()
    }
  })

  ;(['log', 'info', 'warn', 'error'] as const).forEach((level) => {
    const originalMethod = originalConsole[level]

    window.console[level] = function patchedConsole(...args: unknown[]) {
      recordLog(level, 'console', args)
      originalMethod.apply(window.console, args)
    }
  })

  window.addEventListener('error', (event) => {
    const stack = event.error instanceof Error ? event.error.stack || '' : ''

    recordLog(
      'error',
      'window-error',
      [
        event.message || 'Window error',
        `${event.filename || 'unknown'}:${event.lineno || 0}:${event.colno || 0}`,
      ],
      { stack },
    )
  })

  window.addEventListener('unhandledrejection', (event) => {
    const rejection = describeUnhandledRejection(event.reason)

    recordLog(
      'error',
      'unhandledrejection',
      [rejection.title, rejection.detail].filter(Boolean),
      { stack: rejection.stack },
    )
  })

  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch

    window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
      const startedAt = Date.now()
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : String(input)
      const method = (init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase()
      const requestData = init?.body ? safeSerialize(init.body, MAX_REQUEST_PAYLOAD_LENGTH) : ''

      try {
        const response = await originalFetch.call(window, input, init)
        let rawResponseData = ''
        let responseData = ''

        try {
          rawResponseData = await response.clone().text()
          responseData = truncatePayloadText(rawResponseData)
        } catch {
          responseData = '[response body unavailable]'
        }

        const requestDiagnostics = buildRequestDiagnostics(response.status, response.statusText, rawResponseData)

        recordRequest({
          id: createId('fetch'),
          client: 'fetch',
          url,
          method,
          status: response.status,
          statusText: response.statusText,
          duration: Date.now() - startedAt,
          requestData,
          responseData,
          time: formatTime(),
          ok: response.ok && requestDiagnostics.ok,
          failureKind: requestDiagnostics.failureKind,
          businessCode: requestDiagnostics.businessCode,
          businessMessage: requestDiagnostics.businessMessage,
          errorMessage: requestDiagnostics.errorMessage,
        })

        return response
      } catch (error) {
        recordRequest({
          id: createId('fetch'),
          client: 'fetch',
          url,
          method,
          status: null,
          statusText: 'FETCH_ERROR',
          duration: Date.now() - startedAt,
          requestData,
          responseData: '',
          time: formatTime(),
          ok: false,
          failureKind: 'network',
          businessCode: null,
          businessMessage: '',
          errorMessage: safeSerialize(error, MAX_REQUEST_PAYLOAD_LENGTH),
        })

        throw error
      }
    }
  }

  const originalXHROpen = window.XMLHttpRequest.prototype.open
  const originalXHRSend = window.XMLHttpRequest.prototype.send

  window.XMLHttpRequest.prototype.open = function patchedOpen(
    method: string,
    url: string | URL,
    asyncOption: boolean = true,
    username?: string | null,
    password?: string | null,
  ) {
    this.__AI_DEV_CONSOLE_META__ = {
      method: String(method || 'GET').toUpperCase(),
      url: String(url || ''),
      startedAt: 0,
      requestData: '',
    }

    return originalXHROpen.apply(this, [method, url, asyncOption, username, password])
  }

  window.XMLHttpRequest.prototype.send = function patchedSend(body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = this.__AI_DEV_CONSOLE_META__ || {
      method: 'GET',
      url: '',
      startedAt: 0,
      requestData: '',
    }

    meta.startedAt = Date.now()
    meta.requestData = body ? safeSerialize(body, MAX_REQUEST_PAYLOAD_LENGTH) : ''
    this.__AI_DEV_CONSOLE_META__ = meta

    this.addEventListener('loadend', () => {
      const { rawResponsePayload, responseData } = readXHRResponsePayload(this)

      const resolvedStatus = this.status || null
      const resolvedStatusText = this.statusText || (this.status === 0 ? 'XHR_ERROR' : '')
      const requestDiagnostics = buildRequestDiagnostics(
        resolvedStatus,
        resolvedStatusText,
        rawResponsePayload,
        this.status === 0 ? 'XMLHttpRequest failed or was blocked' : '',
      )

      recordRequest({
        id: createId('xhr'),
        client: 'xhr',
        url: meta.url,
        method: meta.method,
        status: resolvedStatus,
        statusText: resolvedStatusText,
        duration: Date.now() - meta.startedAt,
        requestData: meta.requestData,
        responseData,
        time: formatTime(),
        ok: (this.status >= 200 && this.status < 400) && requestDiagnostics.ok,
        failureKind: requestDiagnostics.failureKind,
        businessCode: requestDiagnostics.businessCode,
        businessMessage: requestDiagnostics.businessMessage,
        errorMessage: requestDiagnostics.errorMessage,
      })
    }, { once: true })

    return originalXHRSend.call(this, body)
  }
}
