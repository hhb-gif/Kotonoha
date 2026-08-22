# Round-2 RPC 契约扩展（H1/H2/V 共同遵守）

> 所有方法沿用现有协议：`POST /api/<method>`，body `{type:'client-request',rpcId,method,payload}`，
> 响应 `{type:'server-response',rpcId,result:{ok,value|error}}`。错误一律 `result.ok=false, error:{code,message}`。

## 新增 method 清单

| method | payload | value 返回 |
|--------|---------|-----------|
| `tools.list` | `{}` | `{ tools:[{name,description}] }` |
| `providers.list` | `{}` | `{ defaultId, providers:[{id,name,capabilities?,models:[{id,name?}]}] }` |
| `session.export` | `{sessionId, format:'json'\|'markdown'}` | `{ filename, content }` |
| `session.import` | `{ content, format:'json' }` | `{ sessionId }` |
| `session.archive` | `{sessionId}` | `{ ok:true }` |
| `session.unarchive` | `{sessionId}` | `{ ok:true }` |
| `session.listArchived` | `{}` | `{ sessions:[SessionRecord…] }` |
| `session.compress` | `{sessionId, keepRecent?=5}` | `{ ok:true, summary? }` |
| `rules.get` | `{}` | `{ rules:[{tool,level}] }` |
| `rules.set` | `{ rules:[{tool,level}] }` | `{ ok:true }` |
| `mcp.status` | `{}` | `{ servers:[{id,type,status,tools?}] }`（不自动连接） |
| `memory.bonds.get` | `{sessionId?}` | `{ bonds:[…] }`（可选，实现简单就做） |

## 实现归属

- **H2-backend**：rpc.ts 路由 + 引擎/store/auth/mcp 接线。允许在 `types.ts` 的
  `RpcHandlerContext` 上**追加可选字段**（如 `ops?: {...}`），禁止破坏性修改既有字段。
- **H1-frontend**：bridge.js 增加上述一一对应的方法（命名 `listTools/listProviders/
  exportSession/importSession/archiveSession/unarchiveSession/listArchivedSessions/
  compressSession/getRules/setRules/mcpStatus`），并接 UI：
  - 技能页签 ← tools.list（只读列表+开关占位）
  - 会话页签 ← 导出 MD/JSON、归档、压缩按钮
  - MCP 页签 ← mcp.status
  - 凭据页签追加只读规则列表（rules.get）
  - 设置面板模型下拉 ← providers.list（替换「模型信息加载失败」）
  - 审批 UI 支持「始终允许」(outcome='always')
- **V-verifier**：按本契约写 `agent/scripts/verify-all.mjs` 全量自检脚本。

## 验收口径

1. `npx tsc --noEmit` 零错误（各自负责目录 + 全局）
2. H2：curl 逐个新 method 冒烟通过
3. H1：不破坏现有流程（对话/存档/Fork 回归），新控件渲染正常
4. V：脚本输出 PASS/FAIL 表格，真实 key 缺失的用例标 SKIP
