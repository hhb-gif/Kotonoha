// ============================================================
// api/events.ts —— 事件总线（WebSocket /api/events.mux 的连接管理）
// 广播全部 OutboundFrame；单个连接异常不影响其他连接
// 中文注释、英文标识符
// ============================================================

import type { EventHub, OutboundFrame } from '../types'

/**
 * 构造事件总线：维护 send 回调集合，broadcast 推给所有连接，
 * attach 注册连接并返回注销函数。
 */
export function makeEventHub(): EventHub {
  const sends = new Set<(frame: OutboundFrame) => void>()

  return {
    broadcast(frame: OutboundFrame): void {
      for (const send of [...sends]) {
        try {
          send(frame)
        } catch {
          // 单个连接失败（如 socket 已关闭）不影响其他连接
        }
      }
    },

    attach(send: (frame: OutboundFrame) => void): () => void {
      sends.add(send)
      return () => {
        sends.delete(send)
      }
    },
  }
}
