// ============================================================
// events.js —— 事件总线：bridge 对外事件的订阅与分发
// 对外事件（与 UI 层约定，保持稳定）：
//   user / model / model:done / replay / status / emotion / error / degraded
//   / approval（含 approval:done 兜底关闭）
// ============================================================

const listeners = new Set()

/** 当前订阅者数量（__bridgeDebug 调试用）。 */
export function listenerCount() {
  return listeners.size
}

/** 订阅 bridge 事件；返回取消订阅函数。 */
export function onEvent(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 向所有订阅者分发事件（单个监听器异常不影响其他监听器）。 */
export function emit(event) {
  console.log('[bridge] event →', event.type, event.detail || event.state || event.decision || (event.text ? event.text.slice(0, 30) : ''))
  listeners.forEach((cb) => {
    try {
      cb(event)
    } catch (err) {
      console.error('[bridge] listener error:', err)
    }
  })
}
