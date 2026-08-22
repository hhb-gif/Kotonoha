# B-mcp SPEC: MCP 客户端 (stdio + SSE)

## 目标
实现 MCP 客户端，支持 stdio 和 SSE 两种 transport，能连接标准 MCP server (filesystem, github, sqlite 等)，将 MCP tool 映射为 harness Tool。

## 接口契约
```ts
interface MCPClient {
  connect(config: MCPServerConfig): Promise<MCPConnection>
  listTools(): Promise<MCPTool[]>
  callTool(name: string, args: unknown): Promise<MCPToolResult>
  close(): Promise<void>
}
interface MCPServerConfig {
  type: 'stdio' | 'sse'
  command?: string        // stdio: 启动命令
  args?: string[]         // stdio: 参数
  url?: string            // sse: 端点
  headers?: Record<string, string>
}
```

## 交付文件
```
agent/src/mcp/
├── client.ts            # MCPClient 实现 (stdio + SSE)
├── transport/stdio.ts   # stdio transport (spawn + JSON-RPC)
├── transport/sse.ts     # SSE transport (EventSource + POST)
├── registry.ts          # MCPRegistry: 管理多连接、工具映射
├── mapper.ts            # MCPTool -> harness Tool (schema 转换)
└── index.ts             # buildDefaultMCP() 导出预置配置
```

## 预置 MCP Server 配置
```ts
// 内置默认配置 (用户可在设置面板增删)
const BUILTIN_SERVERS = [
  { id: 'filesystem', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{cwd}'] },
  { id: 'github', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
  { id: 'sqlite', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sqlite', '{cwd}/data.db'] },
]
```

## 验收标准
| 场景 | 预期 |
|------|------|
| 连接 filesystem stdio | `listTools` 返回 read/write/list 等，调用 `read_file` 能读取本地文件 |
| 连接 github stdio (需 token) | 能列出 repos、创建 issue (需配置 GITHUB_TOKEN) |
| 连接 SSE server | 能连接远程 SSE endpoint，工具调用正常 |
| 多连接并存 | 同时连接 filesystem + github，工具名冲突自动加前缀 `fs_`/`gh_` |
| 断线重连 | server 进程退出后自动重连 (指数退避) |
| 工具映射 | MCP schema -> JSONSchema 无损，required/默认值保留 |

- `npx tsc --noEmit` 零错误
- 单测：mock transport 验证 JSON-RPC 帧收发
- 集成测：启动真实 `@modelcontextprotocol/server-filesystem` 进程跑通

## 依赖
- 新增依赖：`@modelcontextprotocol/sdk` (MCP 官方 SDK)
- 依赖 `agent/src/tools/registry.ts` (Tool 接口)
- 依赖 `agent/src/types.ts`

## 非目标
- 不实现 MCP resources/prompts (M3 v2 再做)
- 不做 OAuth 认证流 (用户自行配置 token)

## 交付时间
M1 第 2 周末前