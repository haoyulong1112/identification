import {
  MESSAGE_TYPE,
  PAGE_HOOK_MESSAGE_TYPE,
  PAGE_HOOK_SOURCE,
  type PageHookMessage,
} from '../shared/messaging/messages'

function isPageHookMessage(value: unknown): value is PageHookMessage {
  return Boolean(
    value
    && typeof value === 'object'
    && 'source' in value
    && 'type' in value
    && (value as { source?: string }).source === PAGE_HOOK_SOURCE,
  )
}

function isRuntimeAvailable() {
  try {
    return Boolean(chrome?.runtime?.id)
  } catch {
    return false
  }
}

async function forwardToBackground(message: unknown) {
  if (!isRuntimeAvailable()) {
    return
  }

  try {
    await chrome.runtime.sendMessage(message)
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error)

    if (errorText.includes('Extension context invalidated')) {
      return
    }

    console.debug('[ai-dev-console] forward page message failed:', error)
  }
}

window.addEventListener('message', (event: MessageEvent<PageHookMessage>) => {
  const message = event.data

  if (!isPageHookMessage(message)) {
    return
  }

  switch (message.type) {
    case PAGE_HOOK_MESSAGE_TYPE.READY:
      void forwardToBackground({
        type: MESSAGE_TYPE.CONTENT_PAGE_READY,
        payload: message.payload,
      })
      break

    case PAGE_HOOK_MESSAGE_TYPE.LOG_RECORDED:
      void forwardToBackground({
        type: MESSAGE_TYPE.CONTENT_LOG_RECORDED,
        payload: message.payload,
      })
      break

    case PAGE_HOOK_MESSAGE_TYPE.REQUEST_RECORDED:
      void forwardToBackground({
        type: MESSAGE_TYPE.CONTENT_REQUEST_RECORDED,
        payload: message.payload,
      })
      break

    default:
      break
  }
})

try {
  window.postMessage({
    source: PAGE_HOOK_SOURCE,
    type: PAGE_HOOK_MESSAGE_TYPE.SYNC_REQUEST,
    payload: {
      requestedAt: Date.now(),
    },
  } satisfies PageHookMessage, '*')
} catch {
  // ignore invalidated extension context during hot reload / extension reload
}
