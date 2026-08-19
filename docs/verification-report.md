# dsh 对外协议验证报告

> 子任务 A：验证 DeepSeek Harness（dsh）对外协议是否支持外部进程驱动
> 日期：2026-08-19
> 环境：Windows 10，Node v22.22.3，dsh v0.1.0-rc.7（全局安装于 `C:\Users\10660\.nvm\versions\node\v22.22.3\bin\node_modules\@deepseek-ai\dsh`）

---

## 0. 结论（TL;DR）

**✅ 完全可行（可行性确认）**

dsh web 对外暴露完整的、无认证的 HTTP RPC 桥 + 双 WebSocket 下行事件流。外部进程可以：
- 创建会话、发送消息、接收 agent 的流式回复（含推理/文本/工具调用增量）
- 触发真实工具执行（已验证 `write` 工具在磁盘上创建文件成功）
- 通过事件流观测工具结果与 turn 完成状态

协议**不是**标准 JSON-RPC 2.0，而是 dsh 自研的 **Typert RPC** 四象限消息模型（`client-request` / `server-response` / `server-request` / `client-response`），JSON 格式、结构简单、文档齐全（打包产物内带完整源码和类型定义）。

---

## 1. 可用协议清单

### 1.1 传输层端点

| 端点 | 类型 | 用途 |
|---|---|---|
| `http://127.0.0.1:3080/` | HTTP GET | SPA 前端（dsh Web GUI） |
| `http://127.0.0.1:3080/api/<method>` | HTTP POST | unary RPC 调用（客户端→服务端） |
| `http://127.0.0.1:3080/api/respond` | HTTP POST | 应答服务端请求（审批/提问），本次未实测 |
| `ws://127.0.0.1:3080/api/events.mux` | WebSocket | 会话事件流（下行，只收不发） |
| `ws://127.0.0.1:3080/api/events.host` | WebSocket | host 级事件流（下行，设置变更时推送） |

- 默认端口 **3080**，绑定 `127.0.0.1`；可用 `dsh web --port <n>`、`--host`、`--trusted-host` 调整
- **无 TLS、无认证**；仅有一道 "Host 头信任 fence"（见 §5 坑 1）
- 普通 GET 访问 `/api/events.mux` 返回 426（无 SSE 降级）

### 1.2 RPC 消息格式（Typert RPC）

**请求**（POST body，`Content-Type: application/json`）：

```json
{
  "type": "client-request",
  "rpcId": "ce56211c-ea49-4eef-8ee1-2cf92610389f",
  "method": "session.prompt",
  "payload": { "sessionId": "session-xxx", "mode": "queue", "content": [{ "type": "text", "text": "你好" }] }
}
```

**响应**（HTTP 响应 body）：

```json
{
  "type": "server-response",
  "rpcId": "ce56211c-ea49-4eef-8ee1-2cf92610389f",
  "result": { "ok": true, "value": { "accepted": true } }
}
```

错误时 `result.ok=false`，`result.error` 含 `code`（如 `agent-busy`、`session-not-found`、`model-unavailable`、`internal`）+ `message` + `details`。

**下行帧**（WebSocket 每帧一个 JSON 文本消息，`server-request` 类型）：

```json
{
  "type": "server-request",
  "rpcId": "...",
  "method": "session/event",
  "payload": { "type": "session/event", "sessionId": "...", "event": { "type": "turn/start", "seq": 4, "data": { "turn": 1 } } }
}
```

### 1.3 可用方法清单（RPC Method Map，来自 `dsh-host-apiproxy` 类型定义）

| 域 | 方法 |
|---|---|
| 会话 | `session.list` `session.search` `session.create` `session.history` `session.models` `session.selectModel` `session.rename` `session.fork` `session.prompt` `session.attachment` `session.updateQueue` `session.cancel` |
| 子代理 | `subagent.list` `subagent.history` `subagent.prompt` `subagent.interrupt` |
| Host | `host.describe` `host.pickDirectory` `host.listDirectory` `host.createDirectory` `host.openPath` |
| 工作区 | `workspace.list/create/rename/delete/insertBefore/insertSessionBefore/archiveSession` |
| 技能/预设/目标 | `skill.list` `agentPreset.list/select/read/copy/openDocument/remove` `goal.create/edit/pause/resume/complete/clear` |
| 配置 | `settings.describe/openDocument/update/replace/mutate` `credentials.describe/set/unset` |
| LLM | `llm.providers` `llm.models` `llm.discoverModels` |

### 1.4 关键事件名（events.mux 下行）

- `session/subscribed`（订阅确认，带 lastSeq）
- `session/event`：`permission/preset` `sandbox/mode` `approval/policy` `turn/start` `turn/end` `step/start` `step/end` `user/message` `assistant/message` `assistant/chunk` `session/title` `request/header` `request/context` `llm/retry` `llm/retry-started` `tool/result` 等
- `session/projection`（`title` `permissions` `sessionStats` `tokenUsage` `contextPressure` `contextBreakdown` `sessionListMetadata` `imageLimits` 等）
- `session/queue`（待处理队列）

`assistant/chunk` 增量类型：`block-start` / `reasoning-delta` / `text-delta` / `tool-call-delta` / `block-end`（含完整块）/ `usage` / `finish`（`reason.kind`: `stop` | `tool-calls` | `error`）

---

## 2. 最小对接示例（Node.js，零依赖）

```js
// dsh-client-min.mjs — 外部驱动 dsh：建会话 → 发消息 → 收事件流
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
// 复用 dsh 自带的 ws 包（浏览器端可用原生 WebSocket 替代）
const require = createRequire('C:/Users/10660/.nvm/versions/node/v22.22.3/bin/node_modules/@deepseek-ai/dsh/package.json');
const WebSocket = require('ws');

const BASE = 'http://127.0.0.1:3080';
const rpcId = () => crypto.randomUUID();

async function call(method, payload) {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: rpcId(), method, payload }),
  });
  return await res.json(); // { type:'server-response', rpcId, result:{ok,value|error} }
}

// 1. 打开会话事件流（下行）
const ws = new WebSocket('ws://127.0.0.1:3080/api/events.mux');
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.payload?.type === 'session/event' && m.payload.event?.type === 'assistant/chunk') {
    const c = m.payload.event.data?.chunk;
    if (c?.type === 'text-delta') process.stdout.write(c.text);
    if (c?.type === 'finish') console.log('\n[finish]', c.reason);
  }
});
await new Promise((r) => ws.on('open', r));

// 2. 建会话（cwd 指定工作区）
const created = await call('session.create', { cwd: 'E:\\Kotonoha' });
const sessionId = created.result.value.sessionId;
console.log('session:', sessionId);

// 3. 发消息（异步：立即返回 accepted:true，回复走事件流）
const sent = await call('session.prompt', {
  sessionId, mode: 'queue',
  content: [{ type: 'text', text: '你好，一句话回复' }],
});
console.log('prompt:', JSON.stringify(sent.result));
```

**PowerShell 版最小示例**（探测用）：

```powershell
$body = @{ type='client-request'; rpcId=[guid]::NewGuid().ToString(); method='session.list'; payload=@{} } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:3080/api/session.list' -Method Post -ContentType 'application/json' -Body $body
```

---

## 3. 工具执行验证（从外部触发 + 观测）

**测试内容**：外部进程发送消息"在 `E:\Kotonoha\temp` 创建 `dsh-tool-test.txt`，内容写入 `dsh tool call OK`"，通过事件流观测 agent 执行。

**结果**：✅ 全链路成功

| 步骤 | 结果 |
|---|---|
| `session.create`（cwd=E:\Kotonoha） | ok，返回 `session-357393b3-...`，权限 `workspace-write` |
| `session.prompt`（mode=queue） | ok，`accepted:true` |
| 事件流观测 | 337 帧：`turn/start` → `request/header`（provider 路由确认）→ `reasoning-delta`（178 token 推理）→ `tool-call-delta`（`write` 工具，参数 `{"file_path":"E:\\Kotonoha\\temp\\dsh-tool-test.txt","content":"dsh tool call OK"}`）→ `tool/result`（写入确认）→ `text-delta`（最终回复）→ `turn/end`（`reason.kind:"completed"`） |
| 磁盘验证 | `E:\Kotonoha\temp\dsh-tool-test.txt` 存在，内容 `dsh tool call OK` |
| agent 最终回复 | "收到。已在 `E:\Kotonoha\temp\dsh-tool-test.txt` 创建文件，内容为 "dsh tool call OK"（无换行），写入成功。" |

**结论：工具执行完全可以从外部触发，且事件（工具调用参数、结果、文本增量、turn 状态）全部可被外部收到。** workspace 内的 `write` 未触发审批（approval policy 为 ask 但 workspace-write 沙箱内放行）。

---

## 4. 可行性判定

| 需求 | 结论 |
|---|---|
| 外部进程驱动 dsh 对话 | ✅ 通过 `session.create` + `session.prompt` |
| 接收 agent 流式回复 | ✅ events.mux WebSocket（text/reasoning/tool 增量齐全） |
| 触发真实工具执行（写文件/跑命令） | ✅ 已验证 `write`；`bash`/`pwsh`/`fs` 等工具随会话沙箱权限（默认 workspace-write） |
| 查询历史/状态 | ✅ `session.history` / `session.list` / `session.models` |
| 认证 | 无（仅本机 Host 头 fence），局域网需 `--trusted-host`，0.0.0.0 绑定被 CLI 拒绝 |
| 审批交互 | `approval/policy: ask` 下需审批的操作会推 `server-request`（approval），外部壳需实现 `POST /api/respond` 应答（未实测，类型定义齐全） |

**风险点**：唯一的外部依赖风险是 **LLM provider 可用性**（见 §5 坑 2），与 dsh 协议无关。

---

## 5. 踩到的坑

1. **端口已被占用（EADDRINUSE）**：本机 3080 已有一个 dsh web 实例在跑（node `bin.js web`，PID 20296），重复启动报 `listen EADDRINUSE 127.0.0.1:3080`。排障时可 `dsh web --port <其他端口>` 另起实例。
2. **opencode provider 免费模型被限流（429）**：默认模型 `opencode/deepseek-v4-flash-free` 通过 opencode Console API 调用时返回 `FreeUsageLimitError: Rate limit exceeded`（连续 3 次失败，`turn/end` 以 error 结束）。**解决方案**：`.credentials.yaml` 中已有 `DEEPSEEK_API_KEY`，用 `session.selectModel` 切到 `deepseek-official/deepseek-v4-flash` 后立即恢复正常（实测 3 秒内完成 turn）。集成方案应内置 provider 降级逻辑（`llm.providers` / `llm.models` 可查）。
3. **"JSON-RPC" 说法不精确**：文档声称的 ACP / JSON-RPC 实为 **Typert RPC** 四象限消息模型（`type` 判别字段区分 client-request / server-response / server-request / client-response），`rpcId` 由发起方生成、响应回显。不是标准 JSON-RPC 2.0，但兼容思路相同（照抄示例即可）。
4. **代理**：dsh 实例访问模型走 provider 直连（opencode Console / DeepSeek API），本次未发现走 127.0.0.1:7890 代理的迹象；429 与代理无关。外部壳访问 127.0.0.1:3080 不受代理影响。
5. **Host 头信任 fence**：`/api` 请求必须带合法 `Host`（loopback 直接放行；跨域/非本机需 `--trusted-host`）。浏览器连接自带 Origin 校验；Node/PowerShell 本机调用无影响。
6. **事件流为下行单向**：WebSocket 只收不发；外部壳想主动干预（审批、问题回答）走 `POST /api/respond`，不是 WebSocket。
7. **PowerShell 控制台中文显示乱码**：`ConvertTo-Json` 输出中文在 PS 5.1 控制台显示为乱码是编码显示问题，数据本身（UTF-8）正确；Node 脚本无此问题。

---

## 6. 附录：验证产物

- 探测脚本：`E:\Kotonoha\temp\dsh-probe-1.mjs`（WS 握手 + 建会话 + 发消息 + 事件流全量打印）
- 工具调用测试：`E:\Kotonoha\temp\dsh-probe-2.mjs`（建文件 + 观测 tool/result + 文件校验）
- 测试文件：`E:\Kotonoha\temp\dsh-tool-test.txt`（agent 通过外部驱动创建，内容 `dsh tool call OK`）
- dsh 启动日志：`E:\Kotonoha\temp\dsh-web.log` / `dsh-web.err.log`（本次副本因端口占用失败，运行中实例为 PID 20296）
- 协议类型定义（权威来源）：`dsh-host-apiproxy/lib/types/api/rpc.d.ts`、`rpc-map.d.ts`、`sessions.d.ts`；`dsh-client-connection`（传输层）；`dsh-host-webserver`（端口/绑定）