// Electron 主进程（Kotonoha 桌面壳）
// 职责：
//   1. 启动时 spawn agent harness（node 子进程，黑盒），分配随机空闲端口并等待 /api/health 就绪
//   2. 开发模式加载 vite dev server（5173）；生产加载 vite build 产物 dist/index.html
//   3. 经 preload 把 agent 端口注入渲染层（window.__KOTONOHA_API_BASE__ / __KOTONOHA_WS_BASE__）
//   4. 应用退出时回收 agent 子进程，避免孤儿进程
//   5. 托盘常驻（仅打包环境）+ 关窗最小化到托盘 + 全局快捷键 Ctrl+Shift+K 唤起
//   6. 生产模式注入 CSP 响应头（dev 走 vite HMR 不注入）
const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, globalShortcut, session } =
  require('electron')
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
let tray = null // 托盘实例（仅打包环境创建；创建失败保持 null，退回默认关窗行为）
let forceQuit = false // 退出标志：托盘菜单「退出」等主动退出路径置 true，让 close 拦截放行
let balloonShown = false // 首次最小化到托盘的 balloon 提示只弹一次
// 托盘偏好（userData/tray-pref.json）：关闭时是否最小化到托盘，默认开
let trayPref = { minimizeToTray: true }

// ---- 单实例锁 ----
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  // 已有实例在运行：让第二个实例退出，聚焦已有窗口（由主实例的 second-instance 事件处理）
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      // 窗口可能被最小化到托盘（隐藏）：show 后再 focus 才能真正唤起
      win.show()
      win.focus()
    }
  })
}

// ---- 托盘偏好（userData/tray-pref.json，简单 JSON 读写） ----

/** 读取托盘偏好；文件缺失/损坏时返回默认值（minimizeToTray: true）。 */
function readTrayPref() {
  try {
    const file = path.join(app.getPath('userData'), 'tray-pref.json')
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (raw && typeof raw === 'object') {
      return { minimizeToTray: raw.minimizeToTray !== false }
    }
  } catch {
    // 首次运行或读取失败：静默用默认值
  }
  return { minimizeToTray: true }
}

/** 写入托盘偏好（原子性要求不高，直接覆写；失败仅告警）。 */
function writeTrayPref(pref) {
  try {
    const file = path.join(app.getPath('userData'), 'tray-pref.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(pref, null, 2), 'utf8')
  } catch (err) {
    console.warn('[main] 写入托盘偏好失败:', err.message)
  }
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

// ---- 托盘 ----

/** 显示并聚焦主窗口（托盘单击 / 托盘菜单 / 全局快捷键共用）。 */
function showMainWindow() {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 创建系统托盘（仅打包环境；dev 不建，关窗即退，避免开发困扰）。 */
function createTray() {
  if (!app.isPackaged) return
  try {
    // 打包后托盘图标用 extraResources 里的 resources/icon.ico（与窗口图标同源）
    const iconPath = path.join(process.resourcesPath, 'icon.ico')
    tray = new Tray(iconPath)
    tray.setToolTip('Kotonoha')
    // 单击托盘图标 → 显示主窗口
    tray.on('click', showMainWindow)
    // 右键菜单：显示主窗口 / ─ / 退出
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: showMainWindow },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            // 置退出标志，让窗口 close 拦截逻辑放行（否则 app.quit() 会被 hide 拦截吃掉）
            forceQuit = true
            app.quit()
          },
        },
      ])
    )
    console.log('[main] 系统托盘已创建')
  } catch (err) {
    // 图标缺失等异常：静默降级，退回原关窗即退行为
    console.warn('[main] 托盘创建失败，退回默认关窗行为:', err.message)
    tray = null
  }
}

// ---- 全局快捷键 ----

/** 注册全局快捷键 Ctrl+Shift+K：切换主窗口显示/隐藏（唤起/最小化）。 */
function registerGlobalShortcut() {
  try {
    const ok = globalShortcut.register('Control+Shift+K', () => {
      if (win && win.isVisible() && !win.isMinimized()) {
        win.hide()
      } else {
        showMainWindow()
      }
    })
    // 注册失败（快捷键被其他应用占用等）：静默降级，不影响应用正常使用
    if (!ok) console.warn('[main] 全局快捷键 Control+Shift+K 注册失败（可能被占用）')
  } catch (err) {
    console.warn('[main] 全局快捷键注册异常:', err.message)
  }
}

// ---- CSP（仅生产） ----

// 生产模式 CSP：file:// 产物无响应头，经 onHeadersReceived 注入。
// connect-src 放行本地 agent（http/ws，端口随机所以用通配）；
// style-src 'unsafe-inline' 允许内联样式；img-src file: 允许本地图片。
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: file:",
  "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:* ws://localhost:* http://localhost:*",
  'font-src \'self\' data:',
].join('; ')

/** 生产模式注入 CSP 响应头；dev 走 vite HMR（ws://5173）不注入，避免挡 HMR。 */
function installProductionCSP() {
  if (!app.isPackaged) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // 只对 file:// 响应（生产窗口加载的本地产物）注入；其余响应原样放行
    if (!details.url.startsWith('file://')) return callback({})
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [PROD_CSP],
      },
    })
  })
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
      // sandbox:true：preload 仅用 contextBridge/ipcRenderer/process.argv（均沙箱兼容），
      // 兼容性已实测通过（渲染层可正常连接 agent）
      sandbox: true,
      // 把 agent 端口以命令行参数传给渲染进程，preload 从 process.argv 读取后注入
      additionalArguments: [`--kotonoha-agent-port=${agentPort}`],
    },
  })

  // 关闭拦截：打包 + 托盘可用 + 开启「最小化到托盘」时，点 × 只隐藏窗口（驻留托盘）；
  // 托盘菜单「退出」/更新安装等主动退出路径会置 forceQuit，直接放行真正关闭。
  win.on('close', (event) => {
    if (forceQuit || !app.isPackaged || !tray || !trayPref.minimizeToTray) return
    event.preventDefault()
    win.hide()
    // 首次隐藏弹一次托盘 balloon 提示（仅 Windows；失败静默）
    if (!balloonShown && process.platform === 'win32') {
      balloonShown = true
      try {
        tray.displayBalloon({
          iconType: 'info',
          title: 'Kotonoha',
          content: 'Kotonoha 已最小化到系统托盘，单击托盘图标可重新打开窗口。',
        })
      } catch {
        // balloon 失败静默（个别精简版系统不支持）
      }
    }
  })

  if (isDev) {
    win.loadURL(DEV_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(buildAppMenu())
  // 托盘偏好：读 userData/tray-pref.json（缺失/损坏用默认值）
  trayPref = readTrayPref()
  // 托盘偏好 IPC（供后续设置面板的「关闭时最小化到托盘」开关使用；本轮 UI 未接）
  ipcMain.handle('prefs:getTrayPref', () => trayPref)
  ipcMain.handle('prefs:setTrayPref', (_event, patch) => {
    if (patch && typeof patch === 'object' && typeof patch.minimizeToTray === 'boolean') {
      trayPref = { ...trayPref, minimizeToTray: patch.minimizeToTray }
      writeTrayPref(trayPref)
    }
    return trayPref
  })
  // 生产模式 CSP 注入（须在窗口加载前挂上）
  installProductionCSP()
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
  createTray()
  registerGlobalShortcut()
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
  // 打包环境托盘常驻且开启「最小化到托盘」：窗口隐藏不算退出（darwin 习惯保留：不自动 quit）。
  // 注意：关闭被拦截时窗口只是隐藏，正常不会触发本事件；此分支兜底 darwin Cmd+W 之外的场景。
  if (app.isPackaged && tray && trayPref.minimizeToTray) return
  if (process.platform !== 'darwin') app.quit()
})

// 退出前回收 agent 子进程，避免孤儿进程
// before-quit（正常退出）与 will-quit（任何退出路径，含崩溃兜底）都挂 killAgent
// before-quit 同时置 forceQuit：任何 app.quit() 路径（托盘退出/更新安装/系统关机）都放行窗口关闭
app.on('before-quit', () => {
  forceQuit = true
  killAgent()
})
app.on('will-quit', () => {
  killAgent()
  // 全局快捷键随应用退出注销，避免残留系统级占用
  globalShortcut.unregisterAll()
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