import { globTool } from './src/tools/glob.ts'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), 'kotonoha-glob-debug2')

function makeCtx(cwd: string) {
  return { cwd, sessionId: 'test', approve: async () => 'allowed-once' as const, emit: () => {} }
}

async function main() {
  await rm(TEST_DIR, { recursive: true, force: true })
  await mkdir(TEST_DIR, { recursive: true })
  await mkdir(join(TEST_DIR, 'src'), { recursive: true })
  await mkdir(join(TEST_DIR, 'src/utils'), { recursive: true })
  await mkdir(join(TEST_DIR, 'tests'), { recursive: true })
  await writeFile(join(TEST_DIR, 'src/index.ts'), 'export const a = 1')
  await writeFile(join(TEST_DIR, 'src/utils/helpers.ts'), 'export function help() {}')
  await writeFile(join(TEST_DIR, 'tests/index.test.ts'), 'test("ok", () => {})')

  // 测试大括号展开
  console.log('=== 测试大括号展开 ===')
  let res = await globTool.run(makeCtx(TEST_DIR), { pattern: '{src,tests}/**/*.ts' })
  console.log('ok:', res.ok)
  console.log('output:', res.output)

  // 测试 cwd 参数
  console.log('\n=== 测试 cwd 参数 ===')
  res = await globTool.run(makeCtx(TEST_DIR), { pattern: '*.ts', cwd: 'src' })
  console.log('ok:', res.ok)
  console.log('output:', res.output)
}

main().catch(console.error)