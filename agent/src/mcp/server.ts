// ============================================================
// server.ts —— Kotonoha MCP Server
// 将内置 14 个工具作为 MCP tools 暴露，供其它 agent（hermes/opencode/claude code 等）连接
// 使用 @modelcontextprotocol/sdk 的 Server 类，支持 stdio transport（SSE 可选）
// 工具名加 `kotonoha_` 前缀防冲突
// ============================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import type { Tool, ToolContext, ToolResult } from '../types'
import { buildDefaultTools } from '../tools/registry'

// MCP tool 前缀
const TOOL_PREFIX = 'kotonoha'

// 将 harness ToolDef 转为 MCP tool 定义（name/description/inputSchema）
function toMCPToolDef(tool: Tool) {
  return {
    name: `${TOOL_PREFIX}_${tool.def.name}`,
    description: tool.def.description,
    inputSchema: tool.def.parameters,
  }
}

// 创建 ToolContext（运行时需要 cwd 和 sessionId）
function createToolContext(cwd: string, sessionId: string): ToolContext {
  return {
    cwd,
    sessionId,
    // MCP server 模式下不需要审批，直接允许
    approve: async () => 'allowed-once',
    // 事件发射在 server 模式下静默
    emit: () => {},
  }
}

// 将 ToolResult 转为 MCP content 格式
function toMCPContent(result: ToolResult) {
  if (result.ok) {
    return {
      content: [{ type: 'text' as const, text: result.output }],
      isError: false,
    }
  }
  return {
    content: [{ type: 'text' as const, text: result.error ?? result.output }],
    isError: true,
  }
}

/**
 * 创建并配置 Kotonoha MCP Server
 * @param cwd 工作目录（用于工具沙箱）
 * @param sessionId 会话 ID（可选，用于日志/追踪）
 */
export function createMCPServer(cwd: string, sessionId = `mcp-${Date.now()}`) {
  const tools = buildDefaultTools()
  const toolMap = new Map<string, Tool>()
  
  // 建立前缀名 -> Tool 映射
  for (const tool of tools) {
    const prefixedName = `${TOOL_PREFIX}_${tool.def.name}`
    toolMap.set(prefixedName, tool)
  }

  const server = new Server(
    {
      name: 'kotonoha',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      },
    }
  )

  // tools/list：返回所有带前缀的工具定义
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const mcpTools = tools.map(toMCPToolDef)
    return { tools: mcpTools }
  })

  // tools/call：执行对应的 Tool.run
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    
    const tool = toolMap.get(name)
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      }
    }

    try {
      const ctx = createToolContext(cwd, sessionId)
      const result = await tool.run(ctx, args ?? {})
      return toMCPContent(result)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text', text: `Tool execution failed: ${msg}` }],
        isError: true,
      }
    }
  })

  // ===== 可选：resources 支持（暴露会话列表）=====
  // 这里提供基础框架，实际会话列表需要注入 store/db
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'kotonoha://sessions',
          name: 'Kotonoha Sessions',
          description: 'List of active Kotonoha sessions',
          mimeType: 'application/json',
        },
      ],
    }
  })

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params
    
    if (uri === 'kotonoha://sessions') {
      // 返回空列表框架；实际集成时可注入 store 读取真实会话
      return {
        contents: [
          {
            uri: 'kotonoha://sessions',
            mimeType: 'application/json',
            text: JSON.stringify({ sessions: [] }, null, 2),
          },
        ],
      }
    }
    
    throw new Error(`Unknown resource: ${uri}`)
  })

  return server
}

/**
 * 启动 stdio MCP server（阻塞运行）
 */
export async function startStdioServer(cwd: string): Promise<void> {
  const server = createMCPServer(cwd)
  const transport = new StdioServerTransport()
  
  await server.connect(transport)
  
  // 保持进程存活
  process.stdin.on('close', async () => {
    await server.close()
    process.exit(0)
  })
}

export { TOOL_PREFIX }
export type { ToolContext, ToolResult }