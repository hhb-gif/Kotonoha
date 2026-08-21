// ============================================================
// secrets.ts —— 凭据加密存取（AES-256-GCM，data/secrets.enc）
// 密钥：KOTONOHA_SECRET 环境变量，或 sha256(机器用户目录+固定盐)（玩具级加密）
// 文件格式：base64(iv):base64(authTag):base64(ciphertext) 单行
// 中文注释、英文标识符
// ============================================================

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { SecretsStore } from '../types'

interface SecretEntry {
  value: string
  source: string | null
}

// { ref: { value, source } }
type SecretsData = Record<string, SecretEntry>

const SALT = 'kotonoha-secrets-v1'

// 密钥派生：envSecret 优先，否则 sha256(USERPROFILE|kotonoha|盐)，取 32 字节
function deriveKey(envSecret?: string): Buffer {
  if (envSecret) {
    return crypto.createHash('sha256').update(envSecret).digest()
  }
  const base = `${process.env.USERPROFILE ?? ''}|kotonoha|${SALT}`
  return crypto.createHash('sha256').update(base).digest()
}

function serialize(data: SecretsData, key: Buffer): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':')
}

function deserialize(contents: string, key: Buffer): SecretsData {
  const [ivB64, tagB64, ctB64] = contents.split(':')
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('invalid secrets file format')
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString('utf8')) as SecretsData
}

export function openSecrets(dir: string, envSecret?: string): SecretsStore {
  const file = path.join(dir, 'secrets.enc')
  const key = deriveKey(envSecret)

  // 读盘失败（文件缺失/损坏/密钥不符）→ 视为空 store，不抛错
  let data: SecretsData = {}
  try {
    const contents = fs.readFileSync(file, 'utf8')
    if (contents.trim()) {
      data = deserialize(contents, key)
    }
  } catch {
    data = {}
  }

  const has = (ref: string): boolean =>
    Object.prototype.hasOwnProperty.call(data, ref) && data[ref] !== undefined

  const persist = (): void => {
    // 写盘失败向上抛错
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, serialize(data, key), 'utf8')
  }

  return {
    get(ref: string): string | undefined {
      return data[ref]?.value
    },

    has(ref: string): boolean {
      return has(ref)
    },

    describe(refs: string[]): { ref: string; configured: boolean; source: string | null }[] {
      return refs.map((ref) => ({
        ref,
        configured: has(ref),
        source: data[ref]?.source ?? null,
      }))
    },

    set(ref: string, value: string, source?: string): void {
      data[ref] = { value, source: source ?? null }
      persist()
    },

    remove(ref: string): void {
      if (has(ref)) {
        delete data[ref]
        persist()
      }
    },
  }
}