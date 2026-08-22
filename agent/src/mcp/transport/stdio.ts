// ============================================================
// stdio.ts —— stdio transport for MCP (spawn + JSON-RPC)
// ============================================================

import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'

export interface StdioTransportOptions {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

export interface MCPMessage {
  jsonrpc: '2.0'
  id?: string | number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export class StdioTransport extends EventEmitter {
  private process: ChildProcess | null = null
  private buffer = ''
  private requestId = 0
  private pendingRequests = new Map<string | number, (response: MCPMessage) => void>()
  private closed = false

  constructor(private options: StdioTransportOptions) {
    super()
  }

  async connect(): Promise<void> {
    if (this.process) {
      throw new Error('Already connected')
    }

    this.process = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd ?? process.cwd(),
      env: { ...process.env, ...this.options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.process.stdout?.on('data', (data: Buffer) => this.onData(data))
    this.process.stderr?.on('data', (data: Buffer) => this.onStderr(data))
    this.process.on('close', (code) => this.onClose(code))
    this.process.on('error', (err) => this.onError(err))

    // Wait for process to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000)
      this.once('ready', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  private onData(data: Buffer): void {
    this.buffer += data.toString('utf-8')
    let newlineIndex: number
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (line) {
        try {
          const message: MCPMessage = JSON.parse(line)
          this.handleMessage(message)
        } catch (e) {
          this.emit('error', new Error(`Failed to parse message: ${line}`))
        }
      }
    }
  }

  private onStderr(data: Buffer): void {
    this.emit('stderr', data.toString('utf-8'))
  }

  private onClose(code: number | null): void {
    this.closed = true
    this.cleanup()
    this.emit('close', code)
  }

  private onError(err: Error): void {
    this.emit('error', err)
  }

  private handleMessage(message: MCPMessage): void {
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const resolver = this.pendingRequests.get(message.id)!
      this.pendingRequests.delete(message.id)
      resolver(message)
    } else if (message.method) {
      this.emit('notification', message)
    } else if (!message.id && message.result !== undefined) {
      // Response to a notification? shouldn't happen but handle gracefully
      this.emit('response', message)
    } else {
      this.emit('ready')
    }
  }

  async send(method: string, params?: unknown): Promise<MCPMessage> {
    if (!this.process || this.closed) {
      throw new Error('Transport not connected')
    }

    const id = ++this.requestId
    const message: MCPMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, resolve)
      const line = JSON.stringify(message) + '\n'
      this.process!.stdin!.write(line, (err) => {
        if (err) {
          this.pendingRequests.delete(id)
          reject(err)
        }
      })

      // Timeout for request
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`Request timeout: ${method}`))
        }
      }, 30000)
    })
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (!this.process || this.closed) {
      throw new Error('Transport not connected')
    }

    const message: MCPMessage = {
      jsonrpc: '2.0',
      method,
      params,
    }

    const line = JSON.stringify(message) + '\n'
    this.process!.stdin!.write(line)
  }

  async close(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        this.once('close', () => resolve())
        setTimeout(resolve, 2000) // Force resolve after 2s
      })
    }
    this.cleanup()
  }

  private cleanup(): void {
    this.process = null
    this.buffer = ''
    for (const [, reject] of this.pendingRequests) {
      reject({ jsonrpc: '2.0', id: undefined, error: { code: -32603, message: 'Transport closed' } })
    }
    this.pendingRequests.clear()
  }

  isConnected(): boolean {
    return this.process !== null && !this.closed
  }
}