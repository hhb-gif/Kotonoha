// scripts/prep-agent-electron.cjs
// 打包前准备 agent 运行所需资源（内置 node.exe 方案，零编译）：
//   1. 把 agent/node_modules 里 better-sqlite3 及其运行时依赖（bindings、file-uri-to-path）复制到
//      dist-electron/agent-native（暂存，保留 ABI 127 原构建）
//   2. 把当前系统 node.exe（Node 22，ABI 127）复制到暂存目录，打包时打进 resources/node
// 打包后的 agent 用内置 node.exe 运行，与系统 node 编译的 better-sqlite3 ABI 完全一致，无需 MSVC 重编。
const fs = require('fs')
const path = require('path')

const appDir = path.join(__dirname, '..')
const agentDir = path.join(appDir, '..', 'agent')
const srcModules = path.join(agentDir, 'node_modules')
// 暂存目录放在 app/dist-electron 下（gitignore 的 dist-* 已忽略，不污染 git status）
const staging = path.join(appDir, 'dist-electron', 'agent-native')
const stagingModules = path.join(staging, 'node_modules')

// better-sqlite3 的运行时依赖（prebuild-install 仅为安装期依赖，运行时不需要）
const RUNTIME_DEPS = ['better-sqlite3', 'bindings', 'file-uri-to-path']

for (const dep of RUNTIME_DEPS) {
  if (!fs.existsSync(path.join(srcModules, dep))) {
    console.error(`[prep] 未找到 agent 的 ${dep}：`, path.join(srcModules, dep))
    process.exit(1)
  }
}

// 1. 重建暂存目录：复制原生模块及其运行时依赖（保留 ABI 127 构建，不做任何 rebuild）
fs.rmSync(staging, { recursive: true, force: true })
fs.mkdirSync(stagingModules, { recursive: true })
for (const dep of RUNTIME_DEPS) {
  fs.cpSync(path.join(srcModules, dep), path.join(stagingModules, dep), { recursive: true })
  console.log(`[prep] 已复制 ${dep}`)
}

const bsqliteVersion = require(path.join(stagingModules, 'better-sqlite3', 'package.json')).version
const prodDeps = {}
for (const dep of RUNTIME_DEPS) {
  prodDeps[dep] = require(path.join(stagingModules, dep, 'package.json')).version
}
fs.writeFileSync(
  path.join(staging, 'package.json'),
  JSON.stringify(
    { name: 'agent-electron-build', private: true, version: '0.0.0', dependencies: prodDeps },
    null,
    2
  ),
  'utf8'
)
console.log(`[prep] better-sqlite3 v${bsqliteVersion} 已暂存（保留 ABI 127 构建，零编译）`)

// 2. 复制当前系统 node.exe（Node 22，ABI 127）为内置运行时
//    运行本脚本的 node 即系统 node，其 ABI 与 agent 的 better-sqlite3 一致。
const nodeSrc = process.execPath
const nodeDst = path.join(staging, 'node.exe')
fs.copyFileSync(nodeSrc, nodeDst)
const nodeVer = process.versions.node
console.log(`[prep] 内置 node.exe 已就绪: ${nodeSrc} -> ${nodeDst} (node v${nodeVer})`)