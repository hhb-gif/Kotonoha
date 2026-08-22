# A-tools SPEC: 工具注册表 + 7 核心工具

## 目标
重构 `agent/src/tools/` 为插件化注册表，实现 7 核心工具，统一 schema + 执行器，单测 100% + 集成测全过。

## 接口契约 (types.ts 已定义)
```ts
interface Tool {
  def: ToolDef                    // { name, description, parameters: JSONSchema }
  run(ctx: ToolContext, args: unknown): Promise<ToolResult>
}
interface ToolContext {
  cwd: string
  sessionId: string
  approve: (toolName, callId, reason) => Promise<'allowed-once'|'rejected'>
  emit: (ev: SessionEvent) => void
}
```

## 交付文件
```
agent/src/tools/
├── registry.ts          # ToolRegistry: register/get/list, schema 校验
├── file-read.ts         # read_file(path) -> {content, size}
├── file-write.ts        # write_file(path, content) -> {bytes}
├── file-edit.ts         # edit_file(path, oldStr, newStr) -> {changed}
├── glob.ts              # glob(pattern) -> string[]
├── grep.ts              # grep(pattern, path?) -> {file, line, match}[]
├── task.ts              # task(description, prompt) -> 子 agent 结果
├── bash.ts              # bash(command, timeout?) -> {stdout, stderr, code}
├── patch.ts             # apply_patch(patch) -> {applied}
└── index.ts             # buildDefaultTools() 导出 7 工具数组
```

## 验收标准
| 工具 | 单测用例 | 集成测场景 |
|------|----------|------------|
| read_file | 存在/不存在/二进制/大文件 | 读取 agent/src 目录下所有 .ts |
| write_file | 新建/覆盖/权限/路径遍历防御 | 写入临时文件再读回对比 |
| file-edit | 精确替换/多处/未找到/无变化 | 修改 SPEC.md 中某行 |
| glob | 递归/非递归/否定模式 | 查找 agent/**/*.ts |
| grep | 正则/固定字符串/大小写/上下文行 | 搜索 "TODO" 在 agent/ |
| task | 成功/失败/超时/并发限制 | 启动子 agent 读文件汇总 |
| bash | 正常/非零退出/超时/信号 | `git status` / `sleep 10` 超时 |

- `npx tsc --noEmit` 零错误
- `vitest run agent/src/tools` 覆盖率 ≥ 90%
- 手动验收：每工具在真实对话中被调用并返回正确结果

## 依赖
- 仅依赖 `agent/src/types.ts` (已稳定)
- 无外部 npm 依赖 (原生 fs/path/child_process)

## 非目标
- 不实现 patch.ts (可选，M3 再做)
- 不做工具级权限规则 (D-auth 负责)
- 不做 MCP 映射 (B-mcp 负责)

## 交付时间
M1 第 1 周末前