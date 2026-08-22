// ============================================================
// sse.ts —— SSE transport for MCP (EventSource + POST)
// ============================================================

import { EventEmitter } from 'events'

export interface SSETransportOptions {
  url: string
  headers?: Record<string, string>
}

export interface MCPMessage {
  jsonrpc: '2.0'
  id?: string | number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface SSEConnection {
  eventSource: EventSource
  abortController: AbortController
}

export class SSETransport extends EventEmitter {
  private connection: SSEConnection | null = null
  private requestId = 0
  private pendingRequests = new Map<string | number, (response: MCPMessage) => void>()
  private closed = false
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000

  constructor(private options: SSETransportOptions) {
    super()
  }

  async connect(): Promise<void> {
    if (this.connection) {
      throw new Error('Already connected')
    }

    return new Promise((resolve, reject) => {
      const abortController = new AbortController()
      
      // Use native EventSource (available in Node 18+)
      // For headers, we need to use a custom implementation or fetch with streaming
      // Here we use fetch with ReadableStream for better control
      this.connectWithFetch(abortController, resolve, reject)
    })
  }

  private async connectWithFetch(
    abortController: AbortController,
    resolve: () => void,
    reject: (err: Error) => void
  ): Promise<void> {
    try {
      const response = await fetch(this.options.url, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          ...this.options.headers,
        },
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      this.connection = { 
        eventSource: null as unknown as EventSource, 
        abortController 
      }

      // Parse SSE stream
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      this.reconnectAttempts = 0
      resolve()

      const readLoop = async (): Promise<void> => {
        try {
          while (!this.closed) {
            const { done, value } = await reader.read()
            if (done) break
            
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            
            for (const line of lines) {
              this.parseSSELine(line.trim())
            }
          }
        } catch (err) {
          if (!this.closed) {
            this.emit('error', err instanceof Error ? err : new Error(String(err)))
            this.handleReconnect()
          }
        }
      }

      readLoop()
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private parseSSELine(line: string): void {
    if (!line || line.startsWith(':')) return // Comment or empty
    
    if (line.startsWith('data: ')) {
      const data = line.slice(6)
      try {
        const message: MCPMessage = JSON.parse(data)
        this.handleMessage(message)
      } catch (e) {
        this.emit('error', new Error(`Failed to parse SSE message: ${data}`))
      }
    } else if (line === 'data:') {
      // Empty data field
    } else if (line.startsWith('event:') || line.startsWith('id:') || line.startsWith('retry:')) {
      // Ignore other SSE fields for now
    }
  }

  private handleMessage(message: MCPMessage): void {
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const resolver = this.pendingRequests.get(message.id)!
      this.pendingRequests.delete(message.id)
      resolver(message)
    } else if (message.method) {
      this.emit('notification', message)
    }
  }

  private handleReconnect(): void {
    if (this.closed || this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.cleanup()
      this.emit('close', new Error('Max reconnect attempts reached'))
      return
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
    
    setTimeout(() => {
      if (!this.closed) {
        this.connect().catch(() => {
          // Reconnect will be attempted again
        })
      }
    }, delay)
  }

  async send(method: string, params?: unknown): Promise<MCPMessage> {
    if (!this.connection || this.closed) {
      throw new Error('Transport not connected')
    }

    const id = ++this.requestId
    const message: MCPMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise(async (resolve, reject) => {
      this.pendingRequests.set(id, resolve)

      try {
        const conn = this.connection
        if (!conn) throw new Error('Not connected')
        const response = await fetch(this.options.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            ...this.options.headers,
          },
          body: JSON.stringify(message),
          signal: conn.abortController.signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        // Response will come via SSE stream
      } catch (err) {
        this.pendingRequests.delete(id)
        reject(err as MCPMessage)
      }

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
    if (!this.connection || this.closed) {
      throw new Error('Transport not connected')
    }

    const message: MCPMessage = {
      jsonrpc: '2.0',
      method,
      params,
    }

    await fetch(this.options.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.options.headers,
      },
      body: JSON.stringify(message),
      signal: this.connection.abortController.signal,
    })
  }

  async close(): Promise<void> {
    this.closed = true
    this.cleanup()
  }

  private cleanup(): void {
    if (this.connection) {
      this.connection.abortController.abort()
      this.connection = null
    }
    for (const [, reject] of this.pendingRequests) {
      reject({ jsonrpc: '2.0', id: undefined, error: { code: -32603, message: 'Transport closed' } })
    }
    this.pendingRequests.clear()
  }

  isConnected(): boolean {
    return this.connection !== null && !this.closed
  }
}