// ============================================================
// registry.ts —— MCPRegistry: 管理多连接、工具映射
// ============================================================

import type { Tool } from '../types'
import { MCPClient, MCPServerConfig, MCPConnection } from './client'
import { mapMCPToolsToHarness } from './mapper'

export interface RegisteredServer {
  id: string
  config: MCPServerConfig
  connection: MCPConnection | null
  tools: Tool[]
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
  reconnectAttempts: number
  maxReconnectAttempts: number
}

export class MCPRegistry {
  private client = new MCPClient()
  private servers = new Map<string, RegisteredServer>()
  private toolPrefixes = new Map<string, string>()
  private allTools = new Map<string, Tool>()
  private reconnectTimers = new Map<string, NodeJS.Timeout>()

  // Default prefix mapping for known servers
  private defaultPrefixes: Record<string, string> = {
    filesystem: 'fs',
    github: 'gh',
    sqlite: 'sql',
  }

  registerServer(config: MCPServerConfig, customPrefix?: string): string {
    const id = config.type === 'stdio' 
      ? `${config.type}-${config.command}-${config.args?.join('-')}`
      : `${config.type}-${config.url}`
    
    const shortId = this.generateShortId(config)
    
    if (this.servers.has(shortId)) {
      throw new Error(`Server ${shortId} already registered`)
    }

    const prefix = customPrefix ?? this.defaultPrefixes[shortId] ?? shortId
    this.toolPrefixes.set(shortId, prefix)

    const server: RegisteredServer = {
      id: shortId,
      config,
      connection: null,
      tools: [],
      status: 'disconnected',
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
    }

    this.servers.set(shortId, server)
    return shortId
  }

  async connectServer(id: string): Promise<void> {
    const server = this.servers.get(id)
    if (!server) {
      throw new Error(`Server ${id} not found`)
    }

    if (server.status === 'connecting' || server.status === 'connected') {
      return
    }

    server.status = 'connecting'
    server.error = undefined

    try {
      const connection = await this.client.connect(server.config)
      server.connection = connection
      server.status = 'connected'
      server.reconnectAttempts = 0

      // Load tools
      const mcpTools = await connection.listTools()
      const prefix = this.toolPrefixes.get(id) ?? id
      const tools = mapMCPToolsToHarness(mcpTools, connection, prefix)
      
      server.tools = tools
      this.updateToolRegistry()
    } catch (error) {
      server.status = 'error'
      server.error = error instanceof Error ? error.message : String(error)
      this.scheduleReconnect(id)
      throw error
    }
  }

  async disconnectServer(id: string): Promise<void> {
    const server = this.servers.get(id)
    if (!server) return

    this.cancelReconnect(id)

    if (server.connection) {
      await server.connection.close()
      server.connection = null
    }

    server.status = 'disconnected'
    server.tools = []
    this.updateToolRegistry()
  }

  async reconnectServer(id: string): Promise<void> {
    const server = this.servers.get(id)
    if (!server) {
      throw new Error(`Server ${id} not found`)
    }

    server.reconnectAttempts = 0
    await this.connectServer(id)
  }

  private scheduleReconnect(id: string): void {
    const server = this.servers.get(id)
    if (!server || server.reconnectAttempts >= server.maxReconnectAttempts) {
      return
    }

    this.cancelReconnect(id)

    const delay = Math.min(1000 * Math.pow(2, server.reconnectAttempts), 30000)
    server.reconnectAttempts++

    const timer = setTimeout(async () => {
      if (this.servers.has(id)) {
        const s = this.servers.get(id)!
        if (s.status === 'error' || s.status === 'disconnected') {
          try {
            await this.connectServer(id)
          } catch {
            // Will schedule next reconnect automatically
          }
        }
      }
    }, delay)

    this.reconnectTimers.set(id, timer)
  }

  private cancelReconnect(id: string): void {
    const timer = this.reconnectTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.reconnectTimers.delete(id)
    }
  }

  private updateToolRegistry(): void {
    this.allTools.clear()
    
    for (const [id, server] of this.servers) {
      if (server.status === 'connected') {
        for (const tool of server.tools) {
          this.allTools.set(tool.def.name, tool)
        }
      }
    }
  }

  getTools(): Tool[] {
    return Array.from(this.allTools.values())
  }

  getTool(name: string): Tool | undefined {
    return this.allTools.get(name)
  }

  getServer(id: string): RegisteredServer | undefined {
    return this.servers.get(id)
  }

  listServers(): RegisteredServer[] {
    return Array.from(this.servers.values())
  }

  async connectAll(): Promise<void> {
    const ids = Array.from(this.servers.keys())
    await Promise.allSettled(ids.map((id) => this.connectServer(id)))
  }

  async disconnectAll(): Promise<void> {
    for (const id of this.servers.keys()) {
      await this.disconnectServer(id)
    }
  }

  async setToolPrefix(serverId: string, prefix: string): Promise<void> {
    if (!this.servers.has(serverId)) {
      throw new Error(`Server ${serverId} not found`)
    }
    this.toolPrefixes.set(serverId, prefix)
    // Re-map tools with new prefix
    const server = this.servers.get(serverId)!
    if (server.connection && server.tools.length > 0) {
      const mcpTools = await server.connection.listTools()
      server.tools = mapMCPToolsToHarness(mcpTools, server.connection, prefix)
      this.updateToolRegistry()
    }
  }

  private generateShortId(config: MCPServerConfig): string {
    if (config.type === 'stdio') {
      // Extract server name from command args
      const args = config.args ?? []
      for (const arg of args) {
        if (arg.includes('server-')) {
          return arg.replace('@modelcontextprotocol/', '').replace('server-', '')
        }
      }
      return `stdio-${config.command}`
    }
    return `sse-${new URL(config.url!).hostname}`
  }

  async shutdown(): Promise<void> {
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer)
    }
    this.reconnectTimers.clear()
    await this.disconnectAll()
  }
}