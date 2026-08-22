import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { globTool } from '../glob'

const TEST_DIR = join(tmpdir(), 'kotonoha-debug-glob')

function makeCtx(cwd: string) {
  return { cwd, sessionId: 'test', approve: async () => 'allowed-once' as const, emit: () => {} }
}

describe('debug glob', () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
    await mkdir(TEST_DIR, { recursive: true })
    await mkdir(join(TEST_DIR, 'src'), { recursive: true })
    await mkdir(join(TEST_DIR, 'src/utils'), { recursive: true })
    await writeFile(join(TEST_DIR, 'src/index.ts'), 'export const a = 1')
    await writeFile(join(TEST_DIR, 'src/utils/helpers.ts'), 'export function help() {}')
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  it('debug', async () => {
    const res = await globTool.run(makeCtx(TEST_DIR), { pattern: 'src/**/*.ts' })
    console.log('ok:', res.ok)
    console.log('output:', res.output)
    console.log('error:', res.error)
    expect(res.ok).toBe(true)
  })
})