// scripts/prep-agent-electron.cjs
// 打包前为 agent 准备 Electron ABI 的 better-sqlite3 原生模块：
//   1. 把 agent/node_modules/better-sqlite3 复制到 agent/build-electron/node_modules/better-sqlite3（暂存）
//   2. 用 @electron/rebuild 把它重建为 Electron ABI（依赖 MSVC + Python 构建工具链）
// 注意：
//   - 不动 agent 的开发用 node_modules（dev 模式走系统 node 的 ABI 构建）
//   - 本机无 MSVC 时重建会失败：保留原构建并给出警告，打包后 agent 退化为骨架模式（窗口/会话可用，模型对话不可用）
//   - 在装有 Visual Studio Build Tools 的机器上运行本脚本可生成完整可用的安装包
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const appDir = path.join(__dirname, '..')
const agentDir = path.join(appDir, '..', 'agent')
const srcNative = path.join(agentDir, 'node_modules', 'better-sqlite3')
// 暂存目录放在 app/dist-electron 下（gitignore 的 dist-* 已忽略，不污染 git status）
const staging = path.join(appDir, 'dist-electron', 'agent-native')
const stagingNative = path.join(staging, 'node_modules', 'better-sqlite3')

const electronPkg = require(path.join(appDir, 'node_modules', 'electron', 'package.json'))
const ELECTRON_VERSION = process.env.KOTONOHA_ELECTRON_VERSION || electronPkg.version

if (!fs.existsSync(srcNative)) {
  console.error('[prep] 未找到 agent 的 better-sqlite3：', srcNative)
  process.exit(1)
}

// 1. 重建暂存目录
fs.rmSync(staging, { recursive: true, force: true })
fs.mkdirSync(path.dirname(stagingNative), { recursive: true })
fs.cpSync(srcNative, stagingNative, { recursive: true })

const bsqliteVersion = require(path.join(stagingNative, 'package.json')).version
fs.writeFileSync(
  path.join(staging, 'package.json'),
  JSON.stringify(
    { name: 'agent-electron-build', private: true, version: '0.0.0', dependencies: { 'better-sqlite3': `^${bsqliteVersion}` } },
    null,
    2
  ),
  'utf8'
)
console.log(`[prep] 暂存目录已就绪: ${stagingNative}`)

// 2. 重建为 Electron ABI（失败不阻断打包，保留原构建走骨架模式）
const cli = path.join(appDir, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js')
const res = spawnSync(process.execPath, [cli, '-f', '-w', 'better-sqlite3', '-m', staging, '-v', ELECTRON_VERSION], {
  stdio: 'inherit',
})
if (res.status === 0) {
  console.log(`[prep] better-sqlite3 已重建为 Electron ABI（${ELECTRON_VERSION}）`)
} else {
  // 重建失败（如无 MSVC）：把原始构建放回暂存目录，保证打包产物里原生模块完整
  fs.rmSync(stagingNative, { recursive: true, force: true })
  fs.cpSync(srcNative, stagingNative, { recursive: true })
  console.warn('[prep] better-sqlite3 重建失败（需要 MSVC + Python 构建工具链），已保留原构建。')
  console.warn('[prep] 打包后的 agent 将运行在骨架模式（session 在内存中，模型对话不可用）。')
  console.warn('[prep] 在装有 Visual Studio Build Tools 的机器上重跑 `npm run prep:agent:electron` 即可生成完整可用的安装包。')
  process.exit(0)
}