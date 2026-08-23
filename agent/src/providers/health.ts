// ============================================================
// health.ts —— Provider 健康监控（M4-4.2）
// 可用状态存内存 map：不可用 provider 从降级链临时剔除，下次检查通过恢复
// 调度：agent 启动时跑一次 + setInterval 每 10 分钟（stop() 清理 handle）
// 中文注释、英文标识符
// ============================================================

import type { ProviderRegistry } from '../types'

// 单次健康检查超时
const CHECK_TIMEOUT_MS = 5_000

export interface HealthCheckResult {
  id: string
  ok: boolean
}

export class HealthMonitor {
  private readonly registry: ProviderRegistry
  // 内存可用状态：id → healthy；无记录（尚未检查过）视为可用，避免误伤冷启动
  private readonly healthy = new Map<string, boolean>()
  // 定时器 handle（供 stop 清理）
  private timer: ReturnType<typeof setInterval> | null = null
  // 防重入：上次检查未完成时跳过本次定时触发
  private inFlight = false

  constructor(registry: ProviderRegistry) {
    this.registry = registry
  }

  /**
   * 遍历全部 provider 执行健康检查（单次 5s 超时），更新内存可用状态。
   * @returns 每家的检查结果
   */
  async checkAll(): Promise<HealthCheckResult[]> {
    if (this.inFlight) return this.snapshot()
    this.inFlight = true
    try {
      const providers = this.registry.list()
      const results = await Promise.all(
        providers.map(async (p) => {
          const ok = await this.withTimeout(p.healthCheck(), CHECK_TIMEOUT_MS)
          this.healthy.set(p.id, ok)
          return { id: p.id, ok }
        })
      )
      // 已注销的 provider 清理状态
      const alive = new Set(providers.map((p) => p.id))
      for (const id of [...this.healthy.keys()]) {
        if (!alive.has(id)) this.healthy.delete(id)
      }
      return results
    } finally {
      this.inFlight = false
    }
  }

  /** 查询单个 provider 可用状态（未检查过 → 默认可用） */
  isHealthy(id: string): boolean {
    return this.healthy.get(id) ?? true
  }

  /** 全部 provider 当前状态（供 providers.health RPC） */
  getStatus(): { id: string; name: string; healthy: boolean }[] {
    return this.registry.list().map((p) => ({
      id: p.id,
      name: p.name,
      healthy: this.isHealthy(p.id),
    }))
  }

  /** 快照：当前内存状态（checkAll 防重入时返回） */
  snapshot(): HealthCheckResult[] {
    return this.registry.list().map((p) => ({ id: p.id, ok: this.isHealthy(p.id) }))
  }

  /**
   * 启动调度：立即跑一次 + 每 intervalMs 跑一次（幂等，重复 start 会重置定时器）。
   * @param intervalMs 检查间隔（默认 10 分钟）
   */
  start(intervalMs = 10 * 60 * 1000): void {
    this.stop()
    void this.checkAll()
    this.timer = setInterval(() => {
      void this.checkAll().catch((e) => {
        console.warn('[health] 定期检查失败:', (e as Error).message)
      })
    }, intervalMs)
  }

  /** 停止调度并清理定时器 */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 单次检查的 5s 超时包装 */
  private async withTimeout(p: Promise<boolean>, ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      return await Promise.race([
        p,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), ms)
        }),
      ])
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }
}