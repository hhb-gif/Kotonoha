// ============================================================
// permission.ts —— 工具权限三档（allow / ask / deny）
// M0 引擎统一按 ask 走审批流；此类为后续「前端技能开关映射」预留扩展位
// ============================================================

export type PermissionMode = 'allow' | 'ask' | 'deny'

export class PermissionChecker {
  private mode: PermissionMode
  private readonly allowList: Set<string>
  private readonly denyList: Set<string>

  constructor(opts?: { mode?: PermissionMode; allowList?: string[]; denyList?: string[] }) {
    this.mode = opts?.mode ?? 'ask'
    this.allowList = new Set(opts?.allowList ?? [])
    this.denyList = new Set(opts?.denyList ?? [])
  }

  // denyList 优先（命中→deny）→ allowList（命中→allow）→ 兜底 mode
  check(toolName: string): 'allow' | 'ask' | 'deny' {
    if (this.denyList.has(toolName)) return 'deny'
    if (this.allowList.has(toolName)) return 'allow'
    return this.mode
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode
  }

  getMode(): PermissionMode {
    return this.mode
  }
}