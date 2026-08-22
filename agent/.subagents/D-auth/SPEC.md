# D-auth SPEC: 权限引擎 + 审批队列

## 目标
实现三档权限 (allow/ask/deny) + 工具级规则 + once/always/reject 审批队列，5 分钟超时自动拒绝，18/18 冒烟全过。

## 接口契约 (types.ts 已定义)
```ts
type PermissionLevel = 'allow' | 'ask' | 'deny'

interface PermissionRule {
  tool: string                    // '*' 或具体工具名
  level: PermissionLevel
  condition?: (ctx: ToolContext) => boolean  // 可选条件 (如路径前缀)
}

interface ApprovalRequest {
  id: string
  sessionId: string
  toolName: string
  callId: string
  args: unknown
  reason: string
  timestamp: number
  timeoutMs: number               // 默认 5min
  resolve: (outcome: 'allowed-once'|'always'|'rejected') => void
}

interface AuthEngine {
  check(tool: string, ctx: ToolContext): PermissionLevel
  requestApproval(req: ApprovalRequest): Promise<'allowed-once'|'always'|'rejected'>
  respond(approvalId: string, outcome: 'allowed-once'|'always'|'rejected'): boolean
  setRules(rules: PermissionRule[]): void
  getRules(): PermissionRule[]
}
```

## 交付文件
```
agent/src/auth/
├── permission.ts          # PermissionEngine: 规则匹配、默认 ask
├── approver.ts            # Approver: 队列管理、超时、once/always/reject
├── rules.ts               # 内置规则 + 用户规则持久化 (store)
└── index.ts               # buildDefaultAuth() 导出 engine + 默认规则
```

## 默认规则
```ts
const DEFAULT_RULES: PermissionRule[] = [
  { tool: 'read_file',   level: 'allow' },
  { tool: 'glob',        level: 'allow' },
  { tool: 'grep',        level: 'allow' },
  { tool: 'task',        level: 'allow' },
  { tool: 'write_file',  level: 'ask',   condition: ctx => !ctx.cwd.includes('.git') },
  { tool: 'file_edit',   level: 'ask' },
  { tool: 'bash',        level: 'ask',   condition: ctx => !isDangerous(ctx.args.cmd) },
  { tool: 'patch',       level: 'ask' },
  { tool: '*',           level: 'deny' },  // 兜底
]
```

## 验收标准
| 场景 | 预期 |
|------|------|
| 允许工具 (read_file) | 直接执行，无审批 |
| 询问工具 (write_file) | 发 approval/requested，前端 Toast，用户允许 -> 执行 |
| 拒绝工具 (危险 bash) | 直接 blocked，返回 ToolResult {ok:false, error:'denied'} |
| always 规则 | 用户点 "始终允许" -> 后续同工具同参数模式自动通过 |
| 超时 5min | 无响应 -> 自动 rejected，前端 Toast "审批超时" |
| 规则热更新 | 前端修改规则 -> 立即生效，无需重启 |
| 条件匹配 | write_file 在 .git 外 -> ask，在 .git 内 -> deny |

- `npx tsc --noEmit` 零错误
- 单测：18 场景 (3档 × 3工具 × 2条件) 全过
- 压测：100 并发审批请求，队列有序，无泄漏

## 依赖
- 依赖 `agent/src/types.ts` (ToolContext, PermissionLevel)
- 依赖 `agent/src/store/secrets.ts` (规则持久化)

## 非目标
- 不做复杂策略语言 (CEL/OPA)，规则保持简单 JSON
- 不做审计日志审计 (M3 再做)

## 交付时间
M1 第 1 周末前 (与 A-tools 并行)