import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { readdir, stat } from 'node:fs/promises'

const TEST_DIR = join(tmpdir(), 'kotonoha-debug-glob2')

function patternToRegex(pattern: string): RegExp {
  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, 'GLOBSTAR')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/GLOBSTAR/g, '(?:.*/)?')
    .replace(/\{([^}]+)\}/g, (_, inner) => {
      const options = inner.split(',').map((o: string) => o.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
      return `(?:${options.join('|')})`
    })
  return new RegExp(`^${regexStr}$`)
}

describe('debug glob pattern', () => {
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

  it('test pattern', async () => {
    const pattern = 'src/**/*.ts'
    const regex = patternToRegex(pattern)
    console.log('pattern:', pattern)
    console.log('regex:', regex)

    // 测试相对路径
    const testPaths = [
      'src/index.ts',
      'src/utils/helpers.ts',
      'src/utils/types.ts',
    ]
    for (const p of testPaths) {
      console.log(`  ${p}: ${regex.test(p)}`)
    }
  })
})