# E-memory SPEC: 规则/记忆/上下文构建

## 目标
实现 KOTONOHA.md 规则文件加载、@mention 文件注入、羁绊记忆自动沉淀，上下文构建器 (ContextBuilder) 统一组装 systemPrompt + 历史 + 规则 + 文件引用。

## 接口契约
```ts
interface MemoryEngine {
  // 规则文件
  loadRules(projectRoot: string): Promise<RuleSet>
  saveRules(rules: RuleSet): Promise<void>
  // @mention 文件注入
  resolveMentions(text: string, cwd: string): Promise<{text:string, files:FileRef[]}>
  // 羁绊记忆
  recordBond(sessionId: string, bond: BondEntry): Promise<void>
  getBonds(sessionId?: string): Promise<BondEntry[]>
  // 上下文构建
  buildContext(opts: ContextOpts): Promise<ContextResult>
}

interface ContextOpts {
  sessionId: string
  userText: string
  history: HistoryEvent[]
  projectRoot: string
  maxTokens: number
  reservedTokens: number
}
interface ContextResult {
  systemPrompt: string
  messages: ChatMessage[]           // 含 @mention 展开的文件内容
  usedTokens: number
  truncated: boolean
}
```

## 交付文件
```
agent/src/memory/
├── rules.ts               # RuleSet: 加载/合并 KOTONOHA.md (项目/用户/会话三层)
├── mentions.ts            # @mention 解析 -> 读取文件内容 -> 注入 messages
├── bonds.ts               # 羁绊记忆: 关键决策/偏好 -> 追加规则文件
├── context.ts             # ContextBuilder: 组装 systemPrompt + 历史 + 规则 + 文件
├── summarizer.ts          # 上下文压缩: 超长历史 -> 摘要 (调用小模型)
└── index.ts               # buildDefaultMemory() 导出 engine
```

## 规则文件格式 (KOTONOHA.md)
```markdown
# KOTONOHA 规则

## 项目规则 (项目根目录)
- 始终使用 TypeScript 严格模式
- 测试覆盖率不低于 80%

## 用户规则 (~/.kotonoha/rules.md)
- 我偏好函数式编程风格
- 提交信息用 Conventional Commits

## 会话规则 (会话级，自动沉淀)
- 2026-08-21: 用户希望 git commit 前跑测试
```

## 验收标准
| 场景 | 预期 |
|------|------|
| 加载三层规则 | 项目 > 用户 > 会话 优先级合并，后者覆盖前者 |
| @file.ts 注入 | 用户输入 `@agent/src/tools/file-read.ts` -> 读取内容注入 messages 作为 system 片段 |
| @dir/ 整目录 | 递归读取 .ts 文件，总大小超限时截断并提示 |
| 羁绊记忆 | 用户说"以后 git commit 前一定跑测试" -> 自动追加到会话规则 |
| 上下文压缩 | history > maxTokens 时，调用小模型摘要旧轮次，保留最近 N 轮 |
| Token 统计 | 精确计算 systemPrompt + messages + tools schema token 数 |

- `npx tsc --noEmit` 零错误
- 单测：规则合并/mention 解析/压缩摘要
- 集成测：真实对话中触发 @mention + 羁绊生成

## 依赖
- 依赖 `agent/src/tools/` (read_file/glob 用于 @mention)
- 依赖 `agent/src/providers/` (summarizer 调用小模型)
- 依赖 `agent/src/store/` (规则持久化)

## 非目标
- 不做向量检索/RAG (M4 后再考虑)
- 不做跨会话全局记忆检索 (仅会话级羁绊)

## 交付时间
M1 第 3 周末前