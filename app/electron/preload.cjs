// Preload：向渲染进程注入 agent 地址与原生能力（contextIsolation 下走 contextBridge）
// 渲染层 bridge.js 读取 window.__KOTONOHA_API_BASE__ / __KOTONOHA_WS_BASE__；
// 浏览器 dev 环境（vite proxy）不注入，走相对路径。
// agent 端口由主进程通过 additionalArguments（--kotonoha-agent-port=<port>）传入，
// 保证打包后也能拿到实际随机端口（而非写死的 3080）。
// __KOTONOHA_PICK_DIR__：弹出目录选择对话框（新建项目选工作区用）；浏览器环境无此能力。
const { contextBridge, ipcRenderer } = require('electron')

// 从 process.argv 解析主进程注入的 agent 端口；缺失/非法时为 null
function getAgentPort() {
  const arg = process.argv.find((a) => a.startsWith('--kotonoha-agent-port='))
  if (!arg) return null
  const port = Number(arg.slice('--kotonoha-agent-port='.length))
  return Number.isInteger(port) && port > 0 ? port : null
}

const agentPort = getAgentPort()
const apiBase = agentPort ? `http://127.0.0.1:${agentPort}` : ''
const wsBase = agentPort ? `ws://127.0.0.1:${agentPort}` : ''

contextBridge.exposeInMainWorld('__KOTONOHA_API_BASE__', apiBase)
contextBridge.exposeInMainWorld('__KOTONOHA_WS_BASE__', wsBase)
contextBridge.exposeInMainWorld('__KOTONOHA_PICK_DIR__', () => ipcRenderer.invoke('pick-directory'))

// 应用内更新能力（设置面板「检查更新」用）：
//   checkUpdate    手动触发更新检查（返回 { ok, state, version? }）
//   downloadUpdate 下载更新（NSIS 自动下载 / portable 打开 Release 页）
//   quitAndInstall 重启并安装（仅 NSIS，下载完成后）
//   onStatus       订阅主进程 update:status 推送（返回取消订阅函数）
contextBridge.exposeInMainWorld('__KOTONOHA_UPDATE__', {
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  downloadUpdate: () => ipcRenderer.invoke('app:downloadUpdate'),
  quitAndInstall: () => ipcRenderer.invoke('app:quitAndInstall'),
  onStatus: (cb) => {
    const listener = (_event, payload) => cb(payload)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
})