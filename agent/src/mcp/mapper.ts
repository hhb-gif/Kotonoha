// ============================================================
// mapper.ts —— MCPTool -> harness Tool (schema 转换)
// ============================================================

import type { Tool, ToolDef, ToolContext, ToolResult } from '../types'
import { MCPTool, MCPToolResult, MCPConnection } from './client'

function convertSchema(mcpSchema: Record<string, unknown>): Record<string, unknown> {
  // MCP uses JSON Schema, which is compatible with our ToolDef.parameters
  // Just ensure we handle required fields and defaults properly
  const schema = { ...mcpSchema }
  
  // Ensure type is object
  if (!schema.type) {
    schema.type = 'object'
  }
  
  // Ensure properties exist
  if (!schema.properties) {
    schema.properties = {}
  }
  
  // Ensure required array exists
  if (!schema.required) {
    schema.required = []
  }
  
  return schema
}

function convertResult(mcpResult: MCPToolResult): ToolResult {
  let output = ''
  
  for (const content of mcpResult.content) {
    if (content.type === 'text') {
      output += content.text
    } else if (content.type === 'image') {
      output += `[Image: ${content.mimeType}, ${content.data.length} chars base64]`
    }
  }
  
  return {
    ok: !mcpResult.isError,
    output,
    error: mcpResult.isError ? output : undefined,
  }
}

export function mapMCPToolToHarness(
  mcpTool: MCPTool,
  connection: MCPConnection,
  prefix: string = ''
): Tool {
  const prefixedName = prefix ? `${prefix}_${mcpTool.name}` : mcpTool.name
  
  const toolDef: ToolDef = {
    name: prefixedName,
    description: mcpTool.description,
    parameters: convertSchema(mcpTool.inputSchema),
  }

  return {
    def: toolDef,
    run: async (ctx: ToolContext, args: unknown): Promise<ToolResult> => {
      try {
        const result = await connection.callTool(mcpTool.name, args)
        return convertResult(result)
      } catch (error) {
        return {
          ok: false,
          output: '',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

export function mapMCPToolsToHarness(
  mcpTools: MCPTool[],
  connection: MCPConnection,
  prefix: string = ''
): Tool[] {
  return mcpTools.map((tool) => mapMCPToolToHarness(tool, connection, prefix))
}
