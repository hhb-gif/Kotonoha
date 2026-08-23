// Electron 主进程（Kotonoha 桌面壳）
// 职责：
//   1. 启动时 spawn agent harness（node 子进程，黑盒），分配随机空闲端口并等待 /api/health 就绪
//   2. 开发模式加载 vite dev server（5173）；生产加载 vite build 产物 dist/index.html
//   3. 经 preload 把 agent 端口注入渲染层（window.__KOTONOHA_API_BASE__ / __KOTONOHA_WS_BASE__）
//   4. 应用退出时回收 agent 子进程，避免孤儿进程
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const { spawn } = require('child_process')
const net = require('net')
const fs = require('fs')
const path = require('path')
// 应用内自动更新（electron-updater；dev / portable 分支见 updater.cjs）
const updater = require('./updater.cjs')

const DEV_URL = process.env.KOTONOHA_DEV_URL || 'http://127.0.0.1:5173'
// agent 就绪等待超时（毫秒）
const AGENT_READY_TIMEOUT = 15000
// agent 健康检查轮询间隔（毫秒）
const HEALTH_POLL_INTERVAL = 300
// 开发模式 agent 入口：可用 KOTONOHA_AGENT_ENTRY 覆盖，默认取仓库内 agent/dist/index.js
const DEV_AGENT_ENTRY =
  process.env.KOTONOHA_AGENT_ENTRY || path.join(__dirname, '..', '..', 'agent', 'dist', 'index.js')

// 开发模式（electron . 未打包 或 NODE_ENV=development）：加载 vite dev server
const isDev = !app.isPackaged || process.env.NODE_ENV === 'development'

let win = null
let agentProc = null

// ---- 单实例锁 ----
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  // 已有实例在运行：让第二个实例退出，聚焦已有窗口（由主实例的 second-instance 事件处理）
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

// ---- agent 子进程管理 ----

/** 探测端口是否空闲（可绑定）。 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', () => resolve(false))
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(true))
    })
  })
}

/** 分配 agent 端口：优先在 3180–3279 区间随机挑空闲端口，区间被占满时交由系统分配。 */
async function getFreeAgentPort() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = 3180 + Math.floor(Math.random() * 100)
    if (await isPortFree(port)) return port
  }
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

/** 轮询等待 agent 的 /api/health；就绪返回 true，超时返回 false。 */
async function waitForAgentReady(port) {
  const deadline = Date.now() + AGENT_READY_TIMEOUT
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (res.ok) {
        const body = await res.json()
        if (body && body.ok === true) return true
      }
    } catch {
      // 尚未就绪，继续轮询
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL))
  }
  return false
}

/** 结束 agent 子进程（Windows 下 kill() 即 TerminateProcess）。 */
function killAgent() {
  if (agentProc && agentProc.exitCode === null && agentProc.signalCode === null) {
    agentProc.kill()
    agentProc = null
  }
}

/** 启动 agent 子进程；返回其监听端口，未就绪则抛错。 */
async function startAgent() {
  const port = await getFreeAgentPort()
  let cmd
  let args
  const env = { ...process.env, PORT: String(port) }
  if (app.isPackaged) {
    // 打包后：用内置 node.exe（extraResources -> resources/node/node.exe，Node 22 ABI 127）运行 agent，
    // 与 resources/agent/node_modules/better-sqlite3 的 ABI 127 原生模块完全匹配，无需重编译。
    // 产物放在 resources/agent（extraResources，真实文件，子进程可读）；数据目录移到用户区。
    const nodeBin = path.join(process.resourcesPath, 'node', 'node.exe')
    cmd = nodeBin
    args = [path.join(process.resourcesPath, 'agent', 'dist', 'index.js')]
    env.KOTONOHA_DATA_DIR = path.join(app.getPath('userData'), 'agent-data')
    fs.mkdirSync(env.KOTONOHA_DATA_DIR, { recursive: true })
  } else {
    // 开发：直接用系统 node 跑仓库内 agent 产物
    cmd = process.env.KOTONOHA_NODE_BIN || 'node'
    args = [DEV_AGENT_ENTRY]
  }

  agentProc = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  agentProc.stdout.on('data', (d) => process.stdout.write(`[agent] ${d}`))
  agentProc.stderr.on('data', (d) => process.stderr.write(`[agent] ${d}`))
  agentProc.on('exit', (code, signal) => {
    console.log(`[main] agent 子进程退出 (code=${code} signal=${signal})`)
    agentProc = null
  })

  const ready = await waitForAgentReady(port)
  if (!ready) {
    killAgent()
    throw new Error(
      `agent 未在 ${AGENT_READY_TIMEOUT / 1000}s 内就绪（端口 ${port}，入口 ${cmd} ${args.join(' ')}）`
    )
  }
  console.log(`[main] agent 就绪 @ 127.0.0.1:${port}`)
  return port
}

// ---- 菜单 ----

/** 构建默认菜单：保留基本编辑/视图/窗口操作，隐藏掉对用户无意义的默认菜单。 */
function buildAppMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  return Menu.buildFromTemplate(template)
}

// ---- 窗口 ----

function createWindow(agentPort) {
  // 窗口图标：打包后用 resources/icon.ico（extraResources），开发用仓库内 build/icon.ico
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '..', 'build', 'icon.ico')
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0a0812',
    autoHideMenuBar: true,
    title: 'Kotonoha',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 把 agent 端口以命令行参数传给渲染进程，preload 从 process.argv 读取后注入
      additionalArguments: [`--kotonoha-agent-port=${agentPort}`],
    },
  })

  if (isDev) {
    win.loadURL(DEV_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(buildAppMenu())
  // 目录选择（新建项目选工作区）：返回绝对路径或 null（取消）
  ipcMain.handle('pick-directory', async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '选择项目工作区',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  let agentPort = null
  try {
    agentPort = await startAgent()
  } catch (err) {
    // agent 启动失败不阻塞窗口打开；渲染层拿不到地址会走相对路径并报错提示
    console.error('[main] agent 启动失败:', err.message)
    dialog.showErrorBox('Kotonoha', `Agent 启动失败：\n${err.message}`)
  }

  createWindow(agentPort)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(agentPort)
  })

  // ---- 应用内更新 ----
  // 仅打包环境启用（isPackaged 守卫在 updater 内部）；dev 模式只注册 IPC、不检查
  updater.setWindow(win)
  updater.init()
  updater.startAutoCheck()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 退出前回收 agent 子进程，避免孤儿进程
// before-quit（正常退出）与 will-quit（任何退出路径，含崩溃兜底）都挂 killAgent
app.on('before-quit', () => {
  killAgent()
})
app.on('will-quit', () => {
  killAgent()
})

// 主进程异常兜底：渲染进程崩溃/主进程未捕获异常时也回收 agent
process.on('uncaughtException', (err) => {
  console.error('[main] 未捕获异常:', err)
  killAgent()
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] 未处理的 Promise rejection:', reason)
})

// agent 子进程异常退出（非主动 kill）时：若窗口仍存活，弹窗提示并允许重试
// （agentProc 在 startAgent 里监听 exit 时已置空，这里仅在异常场景兜底记录）
app.on('child-process-gone', (_event, details) => {
  if (details.type === 'Utility') return
  console.warn('[main] 子进程异常退出:', JSON.stringify(details))
})