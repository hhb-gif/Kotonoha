# F-session SPEC: 会话持久化/导出/压缩

## 目标
增强 store 层：会话 CRUD + fork/rename + 导出(JSON/Markdown) + 上下文压缩 + 归档，导出/导入往返无损。

## 接口契约 (扩展 types.ts)
```ts
interface SessionStore {
  // 基础
  createSession(cwd: string): SessionRecord
  getSession(id: string): SessionRecord | undefined
  updateSession(id: string, patch: Partial<SessionRecord>): boolean
  deleteSession(id: string): boolean
  listSessions(): SessionRecord[]
  forkSession(id: string): SessionRecord | null
  // 历史
  appendEvent(id: string, event: HistoryEvent): void
  readEvents(id: string): HistoryEvent[]
  // 新增
  exportSession(id: string, format: 'json'|'markdown'): Promise<string>
  importSession(data: string, format: 'json'|'markdown'): Promise<SessionRecord>
  compressSession(id: string, opts: CompressOpts): Promise<void>
  archiveSession(id: string): Promise<void>
  unarchiveSession(id: string): Promise<void>
}

interface CompressOpts {
  keepRecent: number              // 保留最近 N 轮
  summarizeModel: string          // 摘要用模型 (小模型)
  maxTokens: number               // 目标 token 上限
}
```

## 交付文件
```
agent/src/store/
├── db.ts                    # openDb (现有) + 迁移
├── sessions.ts              # SessionStore 实现 (现有 + 新增方法)
├── secrets.ts               # openSecrets (现有)
├── export.ts                # export/import JSON + Markdown
├── compress.ts              # 压缩逻辑 (调用 providers 小模型)
├── archive.ts               # 归档/解归档 (软删 + 单独表)
└── index.ts                 # buildDefaultStore() 导出 store
```

## 导出格式
```json
// JSON (完整可导入)
{
  "version": 1,
  "session": { "id": "...", "cwd": "...", "label": "...", ... },
  "events": [ { "type": "user/message", "data": {...} }, ... ],
  "metadata": { "exportedAt": "...", "agentVersion": "0.1.0" }
}
```
```markdown
# 对话记录: Kotonoha · 书房夜景
**导出时间**: 2026-08-21 14:30
**会话 ID**: abc-123

---

**你**: 帮我查看 git 状态

**言叶**: 当前仓库状态如下...
```

## 验收标准
| 场景 | 预期 |
|------|------|
| 导出 JSON | 含完整会话元数据 + 事件，可 import 恢复同一会话 ID |
| 导入 JSON | 新建会话，事件逐条重放，history 与原会话一致 |
| 导出 Markdown | 可读性强，含角色名/时间戳/代码块高亮 |
| 压缩会话 | keepRecent=5 -> 仅保留最近 5 轮，其余调用小模型摘要替换 |
| 归档会话 | 从列表隐藏，不占用活跃会话 ID，可 unarchive 恢复 |
| 往返无损 | export JSON -> import -> export JSON 结构相等 (除时间戳) |

- `npx tsc --noEmit` 零错误
- 单测：export/import/compress 往返
- 集成测：真实会话跑 50 轮 -> 压缩 -> 继续对话上下文正确

## 依赖
- 依赖 `agent/src/store/db.ts` (SQLite)
- 依赖 `agent/src/providers/` (压缩摘要调用小模型)
- 依赖 `agent/src/types.ts`

## 非目标
- 不做增量同步/云端备份 (M5 Electron 打包时考虑)
- 不做会话分支可视化 (M3 侧边栏 UI 做)

## 交付时间
M1 第 3 周末前