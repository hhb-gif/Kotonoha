// ============================================================
// index.ts —— buildDefaultMCP() 导出预置配置
// ============================================================

import { MCPRegistry, RegisteredServer } from './registry'
import { MCPServerConfig } from './client'
import type { Tool } from '../types'

export interface MCPManager {
  registry: MCPRegistry
  getTools(): Tool[]
  getTool(name: string): Tool | undefined
  connectAll(): Promise<void>
  disconnectAll(): Promise<void>
  registerServer(config: MCPServerConfig, prefix?: string): string
  connectServer(id: string): Promise<void>
  disconnectServer(id: string): Promise<void>
  getServer(id: string): RegisteredServer | undefined
  listServers(): RegisteredServer[]
  shutdown(): Promise<void>
}

const BUILTIN_SERVERS: MCPServerConfig[] = [
  {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '{cwd}'],
  },
  {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
  },
  {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '{cwd}/data.db'],
  },
]

export function buildDefaultMCP(cwd: string = process.cwd()): MCPManager {
  const registry = new MCPRegistry()

  // Register builtin servers with cwd interpolation
  for (const serverConfig of BUILTIN_SERVERS) {
    const config = interpolateConfig(serverConfig, cwd)
    registry.registerServer(config)
  }

  return {
    registry,
    getTools: () => registry.getTools(),
    getTool: (name: string) => registry.getTool(name),
    connectAll: () => registry.connectAll(),
    disconnectAll: () => registry.disconnectAll(),
    registerServer: (config: MCPServerConfig, prefix?: string) => registry.registerServer(config, prefix),
    connectServer: (id: string) => registry.connectServer(id),
    disconnectServer: (id: string) => registry.disconnectServer(id),
    getServer: (id: string) => registry.getServer(id),
    listServers: () => registry.listServers(),
    shutdown: () => registry.shutdown(),
  }
}

function interpolateConfig(config: MCPServerConfig, cwd: string): MCPServerConfig {
  const interpolated = { ...config }
  
  if (config.args) {
    interpolated.args = config.args.map((arg) => 
      arg.replace('{cwd}', cwd)
    )
  }
  
  if (config.url) {
    interpolated.url = config.url.replace('{cwd}', cwd)
  }
  
  return interpolated
}

export { MCPRegistry } from './registry'
export { MCPClient } from './client'
export type { MCPServerConfig, MCPTool, MCPToolResult, MCPConnection } from './client'
export type { RegisteredServer } from './registry'