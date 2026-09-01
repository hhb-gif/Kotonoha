// ============================================================
// ws.ts —— 最小 WebSocket 服务端（RFC 6455 子集，够用即可）
// 支持：握手、接收客户端掩码帧、发送文本帧、ping→pong、close
// 中文注释、英文标识符
// ============================================================

import http from 'node:http'
import crypto from 'node:crypto'

import type { EventHub, OutboundFrame } from './types'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** 握手响应头 */
function wsAcceptKey(key: string): string {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
}

/** 编码一帧（服务端发送，不掩码；支持 7bit/16bit/64bit 长度） */
function encodeFrame(opcode: number, payload: Buffer): Buffer {
  let header: Buffer
  if (payload.length < 126) {
    header = Buffer.alloc(2)
    header[1] = payload.length
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4)
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }
  header[0] = 0x80 | opcode
  return Buffer.concat([header, payload])
}

function encodeTextFrame(text: string): Buffer {
  return encodeFrame(0x1, Buffer.from(text, 'utf8'))
}

/**
 * 尝试从缓冲开头解码一个完整帧（FIN=1 单帧）。
 * 缓冲不足时返回 null（等待更多数据）；返回 consumed 供调用方推进缓冲。
 */
function tryDecodeFrame(
  buf: Buffer
): { opcode: number; payload: Buffer; consumed: number } | null {
  if (buf.length < 2) return null
  const opcode = buf[0] & 0x0f
  const masked = (buf[1] & 0x80) !== 0
  let len = buf[1] & 0x7f
  let offset = 2
  if (len === 126) {
    if (buf.length < 4) return null
    len = buf.readUInt16BE(2)
    offset = 4
  } else if (len === 127) {
    if (buf.length < 10) return null
    len = Number(buf.readBigUInt64BE(2))
    offset = 10
  }
  const maskLen = masked ? 4 : 0
  if (buf.length < offset + maskLen + len) return null
  const mask = masked ? buf.subarray(offset, offset + 4) : null
  offset += maskLen
  const payload = Buffer.from(buf.subarray(offset, offset + len))
  if (mask) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
  }
  return { opcode, payload, consumed: offset + len }
}

/** 处理 /api/events.mux 的升级请求：握手 → 挂到事件总线 → 读帧循环 */
export function handleWsUpgrade(
  req: http.IncomingMessage,
  socket: import('node:net').Socket,
  head: Buffer,
  hub: EventHub
): void {
  const key = req.headers['sec-websocket-key']
  if (typeof key !== 'string') {
    socket.destroy()
    return
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${wsAcceptKey(key)}\r\n` +
      '\r\n'
  )
  socket.setNoDelay(true)

  // 广播回调：把 OutboundFrame 序列化为文本帧推给客户端
  const send = (frame: OutboundFrame): void => {
    if (socket.destroyed) return
    socket.write(encodeTextFrame(JSON.stringify(frame)))
  }
  const detach = hub.attach(send)

  const cleanup = (): void => {
    detach()
    socket.destroy()
  }
  socket.on('close', cleanup)
  socket.on('end', cleanup)
  socket.on('error', cleanup)

  // 读帧循环：解析完整帧，响应 ping/close；握手后附带的 head 数据一并处理
  let buffer = Buffer.from(head)
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const frame = tryDecodeFrame(buffer)
      if (!frame) break
      buffer = buffer.subarray(frame.consumed)
      if (frame.opcode === 0x8) {
        // close：回 close 帧并关闭
        socket.write(encodeFrame(0x8, frame.payload))
        socket.end()
        return
      } else if (frame.opcode === 0x9) {
        // ping → pong（原样回 payload）
        socket.write(encodeFrame(0xa, frame.payload))
      }
      // 0x1 text / 0x2 binary：客户端无需上行业务数据，忽略
    }
  })
}
