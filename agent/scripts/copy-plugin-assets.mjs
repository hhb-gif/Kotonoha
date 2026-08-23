// ============================================================
// copy-plugin-assets.mjs —— 构建辅助：把插件静态资源复制到 dist
// tsc 只编译 .ts，不复制 plugin.yaml；此脚本在 build 时同步
//   src/tools/plugins/**/plugin.yaml → dist/tools/plugins/**/plugin.yaml
// 保证 dist 形态（node dist/index.js）也能按 manifest 扫描加载插件
// 中文注释、英文标识符
// ============================================================

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AGENT_ROOT = path.resolve(__dirname, '..')
const SRC = path.join(AGENT_ROOT, 'src', 'tools', 'plugins')
const DST = path.join(AGENT_ROOT, 'dist', 'tools', 'plugins')

/** 递归收集目录下所有 plugin.yaml 的相对路径 */
function collectYamls(dir, out, base) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectYamls(abs, out, base)
    } else if (entry.isFile() && entry.name === 'plugin.yaml') {
      out.push(path.relative(base, abs))
    }
  }
  return out
}

if (!existsSync(SRC)) {
  console.log('[copy-plugin-assets] src/tools/plugins 不存在，跳过')
  process.exit(0)
}

const yamls = collectYamls(SRC, [], SRC)
for (const rel of yamls) {
  const target = path.join(DST, rel)
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(path.join(SRC, rel), target)
}
console.log(`[copy-plugin-assets] ${SRC} → ${DST}（${yamls.length} 个 plugin.yaml）`)