// ============================================================
// client.ts —— MCPClient 实现 (stdio + SSE)
// ============================================================

import { StdioTransport } from './transport/stdio'
import { SSETransport } from './transport/sse'

export interface MCPServerConfig {
  type: 'stdio' | 'sse'
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface MCPToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
  isError?: boolean
}

export interface MCPConnection {
  id: string
  config: MCPServerConfig
  listTools(): Promise<MCPTool[]>
  callTool(name: string, args: unknown): Promise<MCPToolResult>
  close(): Promise<void>
  isConnected(): boolean
}

interface InitializeResult {
  protocolVersion: string
  capabilities: {
    tools?: { listChanged?: boolean }
    resources?: { subscribe?: boolean; listChanged?: boolean }
    prompts?: { listChanged?: boolean }
  }
  serverInfo: { name: string; version: string }
}

export class MCPClient {
  private transport: StdioTransport | SSETransport | null = null
  private initialized = false
  private serverInfo: InitializeResult | null = null

  async connect(config: MCPServerConfig): Promise<MCPConnection> {
    if (this.transport) {
      await this.transport.close()
    }

    if (config.type === 'stdio') {
      if (!config.command) {
        throw new Error('stdio transport requires command')
      }
      this.transport = new StdioTransport({
        command: config.command,
        args: config.args ?? [],
        env: config.headers,
      })
    } else {
      if (!config.url) {
        throw new Error('SSE transport requires url')
      }
      this.transport = new SSETransport({
        url: config.url,
        headers: config.headers,
      })
    }

    await this.transport.connect()
    await this.initialize()

    const connection: MCPConnection = {
      id: this.generateId(),
      config,
      listTools: () => this.listTools(),
      callTool: (name, args) => this.callTool(name, args),
      close: () => this.close(),
      isConnected: () => this.transport?.isConnected() ?? false,
    }

    return connection
  }

  private async initialize(): Promise<void> {
    if (!this.transport) throw new Error('No transport')

    const result = await this.transport.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: 'kotonoha-agent',
        version: '0.1.0',
      },
    })

    if (result.error) {
      throw new Error(`Initialize failed: ${result.error.message}`)
    }

    this.serverInfo = result.result as InitializeResult
    this.initialized = true

    // Send initialized notification
    await this.transport.notify('notifications/initialized', {})
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.transport || !this.initialized) {
      throw new Error('Client not initialized')
    }

    const result = await this.transport.send('tools/list', {})
    if (result.error) {
      throw new Error(`List tools failed: ${result.error.message}`)
    }

    return (result.result as { tools: MCPTool[] }).tools
  }

  async callTool(name: string, args: unknown): Promise<MCPToolResult> {
    if (!this.transport || !this.initialized) {
      throw new Error('Client not initialized')
    }

    const result = await this.transport.send('tools/call', { name, arguments: args })
    if (result.error) {
      throw new Error(`Call tool failed: ${result.error.message}`)
    }

    return result.result as MCPToolResult
  }

  async close(): Promise<void> {
    if (this.transport) {
      await this.transport.close()
      this.transport = null
      this.initialized = false
      this.serverInfo = null
    }
  }

  getServerInfo(): InitializeResult | null {
    return this.serverInfo
  }

  private generateId(): string {
    return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }
}