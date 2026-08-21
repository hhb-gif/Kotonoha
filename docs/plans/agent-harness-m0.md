# Agent Harness M0 实施规划（协议兼容替换 dsh）

> 日期：2026-08-20 · 状态：规划已确认（TS / SQLite / M0 含工具+审批）
> 目标：在仓库内自建完整的 agent harness（`agent/`），协议兼容 dsh，前端 bridge 零改动；
> 方向：打造 opencode / Claude Code 级别的集成式 agent，M0 为第一块基石。

---

## 0. 总览

```
E:\Kotonoha\agent\   ← harness 核心（TypeScript，编译 CJS 供 Electron 同进程 require）
├── package.json     ← @kotonoha/agent；deps: better-sqlite3；dev: typescript, @types/node, tsx
├── tsconfig.json    ← strict、ES2022、module: commonjs、outDir: dist
└── src/
    ├── index.ts     ← 入口：启动 HTTP + WS 服务（默认端口 3080）
    ├── types.ts     ← 协议类型全集（RPC/事件/Provider/Tool 接口）★契约源
    ├── core/
    │   ├── engine.ts    ← 会话引擎：create/prompt/history/rename/fork/list/delete/selectModel
    │   ├── agent.ts     ← agent loop：prompt → 流式 → 工具循环 → finish
    │   └── context.ts   ← 上下文构建（角色卡 system prompt + 历史 + 工具定义）
    ├── providers/
    │   ├── registry.ts  ← 供应商注册表
    │   ├── deepseek.ts  ← DeepSeek 官方（OpenAI 兼容 + function calling，默认）
    │   └── openai-compat.ts ← 通用 OpenAI 兼容适配器（Agnes 等按 baseURL 复用）
    ├── tools/
    │   ├── registry.ts  ← 工具注册 + OpenAI schema + 执行器
    │   ├── file.ts      ← read_file / write_file（cwd 沙箱）
    │   ├── terminal.ts  ← run_command（cwd 限定，禁交互命令）
    │   ├── git.ts       ← git_status / git_commit / git_log / git_diff
    │   ├── web.ts       ← fetch_url / web_search（DDG html 解析）
    │   └── skills.ts    ← execute_skill（技能目录，M0 内置「奥义/文案」预设）
    ├── auth/
    │   ├── permission.ts ← 工具权限三档（allow/ask/deny，M0 默认 ask）
    │   └── approver.ts   ← 审批队列：request(发帧+挂起) / respond
    └── store/
        ├── db.ts         ← better-sqlite3 打开/建表/迁移
        ├── sessions.ts   ← 会话 CRUD + 事件追加/读取/fork 复制
        └── secrets.ts    ← 凭据加密存取（AES-256-GCM，密钥=环境变量 KOTONOHA_SECRET 或默认派生）
```

## 1. 协议规格（与 dsh 完全一致——bridge.js 零改动）

### 1.1 RPC（HTTP POST /api/<method>）

请求：`{ "type":"client-request", "rpcId":"<uuid>", "method":"<name>", "payload":{...} }`
响应：`{ "type":"server-response", "rpcId":"<uuid>", "result": { "ok":true, "value":{...} } | { "ok":false, "error":{ "code":"...", "message":"..." } } }`

### 1.2 M0 实现的方法

| method | payload | value | 说明 |
|---|---|---|---|
| session.create | `{ cwd }` | `{ sessionId }` | 建会话；label 默认「对话」 |
| session.prompt | `{ sessionId, mode:'queue', content:[{type:'text',text}] }` | `{ accepted:true }` | 入队执行（若上一 turn 未结束则排队） |
| session.history | `{ sessionId }` | `{ events:[{ event: HistoryEvent }] }` | 见 1.4 |
| session.selectModel | `{ sessionId, provider, model }` | `{ ok:true }` | 切换模型并持久化 |
| session.list | `{}` | `[{ sessionId, cwd, label, provider, model, createdAt, lastActiveAt }]` | |
| session.rename | `{ sessionId, label }` | `{ ok:true }` | |
| session.fork | `{ sessionId }` | `{ sessionId }` | 复制事件为新会话 |
| session.delete | `{ sessionId }` | `{ ok:true }` | |
| credentials.describe | `{ refs:[...] }` | `{ refs:[{ ref, configured, source }] }` | 凭据存在性（不泄露值） |
| mcp.list | `{}` | `{ servers: [] }` | M0 恒空数组 |
| respond | `{ sessionId, approvalId, outcome }` | 见 1.5 | **注意：走 POST /api/respond，body 顶层为 client-response** |

### 1.3 事件流（WebSocket /api/events.mux）

帧格式（bridge 只读 `frame.payload` 与 `frame.type/method`）：

```
会话事件帧： { type:'session/event', payload:{ type:'session/event', sessionId, event: SessionEvent } }
审批请求帧： { type:'server-request', method:'approval/requested', rpcId, payload:{ sessionId, approvalId, toolName, callId, reason } }
```

SessionEvent（type 联合）：
```ts
| { type:'turn/start' }
| { type:'assistant/chunk', data:{ chunk: Chunk } }
| { type:'turn/end' }
Chunk:
| { type:'text-delta', text:string }
| { type:'reasoning-delta' }
| { type:'tool-call-delta', toolCall:{ name:string } }
| { type:'finish', reason:{ kind:'stop'|'error'|'tool-calls', message?:string } }
```
> 广播全部会话事件（bridge 按 sessionId 过滤）；WS 关闭可重连。

### 1.4 HistoryEvent（history 返回，bridge historyToMessages 解析）

```ts
| { type:'user/message', data:{ source:{ kind:'user' }, content:[{ type:'text', text }] } }
| { type:'assistant/message', data:{ message:{ role:'assistant', content:[{ type:'text', text }] } } }
```
> 模型完整回复在 turn 结束时以 assistant/message 追加落库；工具调用不落 assistant/message（仅作为内部步骤）。

### 1.5 审批时序

1. agent loop 决定调用工具 → 查 permission：`ask`（M0 全部默认 ask）
2. 发审批帧（rpcId=新 uuid，approvalId=uuid，toolName，callId=tool-call id，reason=工具+参数摘要）→ 挂起 Promise
3. 前端收帧 → `POST /api/respond`，body：`{ type:'client-response', rpcId:<帧 rpcId>, result:{ ok:true, value:{ sessionId, approvalId, outcome:'allowed-once'|'rejected' } } }`
4. approver 按 rpcId 匹配 → resolve Promise → allowed 执行工具 / rejected 返回错误给模型
> 兜底：respond 无匹配或 5 分钟内无响应 → 自动 rejected（前端 bridge 已有 5s 拒绝兜底，双保险）。

### 1.6 降级（M0 简化）

- 引擎记录上次限流错误；`selectModel` 手动切换；**不自动降级**（前端已有降级 UI 流程依赖 dsh 的 session.selectModel 能力，保持协议能力即可）。

## 2. 数据模型（better-sqlite3，单文件 `data/kotonoha.db`）

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  cwd TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '对话',
  provider TEXT NOT NULL DEFAULT 'deepseek-official',
  model TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  payload TEXT NOT NULL,           -- HistoryEvent JSON
  UNIQUE(session_id, seq)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```
- 凭据：`data/secrets.enc`（AES-256-GCM JSON `{ref: {value, source}}`；密钥 `process.env.KOTONOHA_SECRET || sha256(机器用户目录+固定盐)`，标注玩具级加密）。
- DB 路径：`process.env.KOTONOHA_DATA_DIR || <仓库>/agent/data`。

## 3. 核心接口（types.ts，★子 agent 契约源）

```ts
// ---- Provider ----
interface ProviderChunk =
  | { kind:'text'; text:string }
  | { kind:'reasoning'; text:string }
  | { kind:'tool-call'; id:string; name:string; args:string }   // args 为 JSON 字符串
  | { kind:'done' }
interface ChatMessage { role:'system'|'user'|'assistant'|'tool'; content:string; toolCallId?:string }
interface ToolDef { name:string; description:string; parameters:Record<string,unknown> }
interface StreamParams { model:string; messages:ChatMessage[]; tools?:ToolDef[]; signal?:AbortSignal }
interface ModelProvider {
  id:string; name:string;
  listModels(): Promise<{ id:string; name?:string }[]>;
  streamChat(p:StreamParams): AsyncGenerator<ProviderChunk>;
}

// ---- Tool ----
interface ToolContext {
  cwd:string; sessionId:string;
  approve(toolName:string, callId:string, reason:string): Promise<'allowed-once'|'rejected'>;
  emit(ev:SessionEvent): void;                       // 工具内可发 tool-call-delta 等
}
interface ToolResult { ok:boolean; output:string; error?:string }
interface Tool { def:ToolDef; run(ctx:ToolContext, args:unknown): Promise<ToolResult> }

// ---- Engine ----
interface SessionRecord { id:string; cwd:string; label:string; provider:string; model:string; createdAt:number; lastActiveAt:number }
class SessionEngine {
  constructor(deps: { db:Db; providers:ProviderRegistry; tools:ToolRegistry; approver:Approver; broadcast:(frame:unknown)=>void })
  create(cwd:string): SessionRecord
  prompt(sessionId:string, text:string): { accepted:boolean }   // 入队；idle 立即 run
  history(sessionId:string): { events: { event:HistoryEvent }[] }
  selectModel(sessionId:string, provider:string, model:string): void
  list(): SessionRecord[]
  rename(sessionId:string, label:string): void
  fork(sessionId:string): SessionRecord
  delete(sessionId:string): void
  private runTurn(session:SessionRecord, userText:string): Promise<void>
}

// ---- Store ----
interface Db { /* 见 store/db.ts 导出函数 */ }
```

## 4. 工具清单（M0，7 个）

| name | schema 要点 | 实现 | 备注 |
|---|---|---|---|
| read_file | `{path:string}` | 读 cwd 内文件（path 归一化后必须位于 cwd 内），超 32KB 截断+提示 | 对应技能「文献读取」 |
| write_file | `{path:string, content:string}` | 写文件（同样沙箱） | 「文书撰写」 |
| run_command | `{command:string, cwd?:string}` | child_process.exec，超时 60s，禁 `rm -rf /` 等危险模式（黑名单子串） | 「终端术式」 |
| git_status | `{}` | git status --short -b | 「Git 控制」 |
| git_commit | `{message:string}` | git add -A + commit（无改动返回提示） | |
| git_log | `{count?:number}` | git log --oneline -n | |
| fetch_url | `{url:string, maxChars?:number}` | fetch + 文本化（去标签），默认 8000 字符 | 「异界探访」 |
| web_search | `{query:string, count?:number}` | DDG html 端点解析标题+链接，默认 5 条 | 「检索之眼」 |
| execute_skill | `{skill:string, args?:string}` | 技能目录 scripts（M0 内置 2 个：奥义·模板填充、文案润色） | 「奥义执行」 |

> 工具名保持英文 snake_case（模型更稳）；前端技能开关的映射在 skills.js 由用户侧决定（decideApproval 逻辑不动）。

## 5. 角色卡与上下文（context.ts）

- system prompt 模板（config 可覆盖）：
```
你是「言叶」（Kotonoha），一位……【角色设定见下】
当前工作区：<cwd>
能力：你可以调用工具完成任务……
```
- 角色设定文件：`agent/data/character.md`（不存在则用内置默认；内置默认文案参考 docs/design-draft.md 的言叶人设）。
- 历史：取 events 表 → 转 ChatMessage（user/message→user，assistant/message→assistant）。
- tools：本次 turn 用到的工具 schema 注入（M0 全部注入）。

## 6. 集成（Electron / vite）

- **dev**：`agent/` 单独 `npm run dev`（tsx src/index.ts）起 3080；vite proxy 已指向 3080 → 前端零改动直接可用。
- **Electron**：main.cjs 启动时 `require('../agent/dist/index.js')`（同进程起 server，端口 3080；若已被占用则跳过并复用）→ 打包时 agent/dist + agent/data 随 asar；需要修改 electron-builder.yml 的 files 配置。
- 端口冲突：启动前检测 3080 是否可连（HTTP ping session.list），可用则跳过。

## 7. 验收标准（全部通过才算 M0 完成）

1. `agent/`：`npx tsc --noEmit` 零错误；`npm run dev` 后 3080 可连。
2. 探测脚本（docs/scripts 或临时）：session.create → prompt → 收 text-delta 流 → finish → history 有 2 条事件。
3. 工具调用：prompt「读取当前目录文件列表（用 run_command ls）」→ 前端收到 approval/requested 帧 → respond allowed-once → 模型收到工具结果 → 继续输出 → history 完整。
4. 拒绝路径：respond rejected → 模型收到错误 → turn 正常结束（error 或文本说明）。
5. fork/rename/list/selectModel 全通。
6. 前端浏览器回归：主界面/选择/对话/ESC 全流程走通（vite proxy → 新 agent）。
7. Electron `npm run build:app` 打包后启动：自带 server 可用（同进程起）。

## 8. 任务划分（子 agent，并行第一批 6 个）

| # | 子 agent | 文件 | 交付物 |
|---|---|---|---|
| A | 脚手架+协议层 | agent/package.json、tsconfig.json、src/types.ts、src/api/rpc.ts、src/api/events.ts、src/index.ts | 能起 HTTP+WS 骨架，session.list 返回空数组 |
| B | store 层 | src/store/db.ts、sessions.ts、secrets.ts | SQLite CRUD + 凭据加密，自测脚本 |
| C | providers 层 | src/providers/registry.ts、deepseek.ts、openai-compat.ts | DeepSeek 流式+function calling 可用 |
| D | tools 层 | src/tools/registry.ts、file.ts、terminal.ts、git.ts、web.ts、skills.ts | 9 工具注册齐全 |
| E | auth 层 | src/auth/permission.ts、approver.ts | 审批队列+respond 匹配 |
| F | core 引擎 | src/core/engine.ts、agent.ts、context.ts | 完整 turn 循环（依赖 A-E 接口） |

> 第二批（集成后）：G=Electron 集成、H=验收探测脚本+修复。

## 9. 约束与注意

- 所有子 agent 只写自己文件，**不互相修改**；接口以 types.ts 为准（A 先落 types.ts）。
- 子 agent 完成度验证：各自 `npx tsc --noEmit` 仅检查**自己文件**无类型错误（其他文件缺失的报错忽略）。
- 中文注释、英文标识符；不引入额外依赖（除 better-sqlite3）；全部代码放 E:\Kotonoha\agent\。
- 模型默认：provider=deepseek-official（https://api.deepseek.com），model=deepseek-v4-flash；key 从 secrets（DEEPSEEK_API_KEY）读。
- 不做自动降级、不做 MCP 客户端、不做记忆（M2/M3 里程碑）。