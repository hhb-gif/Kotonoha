// electron/updater.cjs
// 应用内自动更新（electron-updater 集成）
// 职责：
//   1. 仅打包环境（app.isPackaged）启用，dev 模式跳过（不触发网络请求）
//   2. Setup(NSIS) 版：electron-updater 检查 → 询问用户 → 下载 → 重启安装
//   3. Portable 版（electron-builder 注入 PORTABLE_EXECUTABLE_FILE）：electron-updater 不支持
//      portable 自动安装，改为 GitHub API 查最新 release，提示用户手动下载
//   4. 状态统一通过 webContents.send('update:status', payload) 推送到渲染层，由设置面板展示
// 约束：所有网络请求（GitHub API）try/catch + 超时，失败静默不打扰用户。
const { app, ipcMain, shell } = require('electron')
const { autoUpdater } = require('electron-updater')

// 启动后延迟检查的毫秒数（避免阻塞首屏）
const CHECK_DELAY_MS = 4000
// GitHub API 请求超时（毫秒），超时/失败静默
const GITHUB_TIMEOUT_MS = 8000
// GitHub 仓库（owner/repo）
const GITHUB_REPO = 'hhb-gif/Kotonoha'

let win = null
// 是否便携版：electron-builder portable 运行时注入该环境变量
let isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE)
// 最近一次从 GitHub 查到的便携版 release 信息（{ version, url }）
let portableLatest = null
// 防并发：electron-updater 不支持并发的 checkForUpdates
let checking = false
// 是否已初始化（IPC 只注册一次）
let initialized = false

/** 设置窗口引用（供 webContents.send 推送更新状态）。 */
function setWindow(w) {
  win = w
}

/** 向渲染层推送更新状态事件；窗口未就绪时丢弃。 */
function send(payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('update:status', payload)
  }
}

/** 简单 semver 比较：a>b 返回 1，a<b 返回 -1，相等返回 0（忽略预发布后缀）。 */
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

/** 查询 GitHub 最新 release（tag_name + html_url）；失败/超时返回 null（静默）。 */
async function fetchLatestRelease() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Kotonoha' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const data = await res.json()
    return { version: String(data.tag_name || '').replace(/^v/i, ''), url: data.html_url || '' }
  } catch (err) {
    // 网络失败/被墙/超时：静默，不打扰用户
    console.warn('[updater] GitHub 查询最新版本失败（静默）:', err.message)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 注册 autoUpdater 事件 → 推送状态到渲染层。 */
function wireAutoUpdaterEvents() {
  // 先询问用户，不自动下载（下载由设置面板「下载更新」触发）
  autoUpdater.autoDownload = false
  // 退出时自动安装已下载的更新（避免「下载完成但用户忘了装」）
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    send({
      state: 'available',
      version: info?.version || '',
      releaseName: info?.releaseName || '',
      releaseNotes: info?.releaseNotes || '',
    })
  })
  autoUpdater.on('update-not-available', () => {
    send({ state: 'latest', version: app.getVersion() })
  })
  autoUpdater.on('error', (err) => {
    // 网络失败等异常：仅推送状态（前端小字提示，不打扰）
    console.warn('[updater] 更新检查出错（静默）:', err.message)
    send({ state: 'error', message: err.message })
  })
  autoUpdater.on('download-progress', (p) => {
    send({ state: 'downloading', percent: Math.round(p?.percent ?? 0) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    send({ state: 'downloaded', version: info?.version || '' })
  })
}

/**
 * 便携版更新检查：查 GitHub 最新 release。
 * silent=true 时网络失败不推送（启动时自动检查用，避免打扰）；手动检查时推送错误状态。
 */
async function checkPortable(silent) {
  const rel = await fetchLatestRelease()
  if (!rel || !rel.version) {
    if (!silent) send({ state: 'error', message: '无法连接更新服务器' })
    return { ok: true, state: 'error', version: app.getVersion() }
  }
  portableLatest = rel
  if (compareVersions(rel.version, app.getVersion()) > 0) {
    send({ state: 'portable-available', version: rel.version, url: rel.url })
    return { ok: true, state: 'portable-available', version: rel.version, url: rel.url }
  }
  send({ state: 'latest', version: app.getVersion() })
  return { ok: true, state: 'latest', version: app.getVersion() }
}

// ---- IPC ----

/** 手动触发更新检查（设置面板「检查更新」按钮）。 */
async function handleCheckUpdate() {
  const current = app.getVersion()
  if (!app.isPackaged) {
    // dev 模式：不触发任何网络请求/autoUpdater
    return { ok: true, state: 'dev', version: current }
  }
  if (isPortable) {
    return checkPortable(false)
  }
  if (checking) return { ok: true, state: 'checking', version: current }
  checking = true
  // 事件驱动 UI：触发后立即返回，后续状态由 update-* 事件推送（错误事件同样推送）
  autoUpdater.checkForUpdates().finally(() => {
    checking = false
  })
  return { ok: true, state: 'checking', version: current }
}

/** 下载更新（NSIS 自动下载；portable 打开 GitHub Release 页让用户手动下载）。 */
async function handleDownloadUpdate() {
  if (!app.isPackaged) return { ok: false, error: '当前环境不支持下载更新' }
  if (isPortable) {
    // 便携版：打开 Release 页，用户手动下载覆盖
    const rel = portableLatest || (await fetchLatestRelease())
    if (!rel || !rel.url) return { ok: false, error: '未找到可下载的版本' }
    portableLatest = rel
    shell.openExternal(rel.url).catch(() => {})
    return { ok: true, url: rel.url }
  }
  try {
    // 不 await：下载进度由 download-progress 事件推送
    autoUpdater.downloadUpdate().catch((err) => {
      console.warn('[updater] 下载失败（静默）:', err.message)
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/** 重启并安装（仅 NSIS，下载完成后调用）。 */
async function handleQuitAndInstall() {
  if (isPortable) return { ok: false, error: '便携版不支持自动安装，请手动下载覆盖' }
  if (!app.isPackaged) return { ok: false, error: '当前环境不支持自动安装' }
  try {
    autoUpdater.quitAndInstall()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * 初始化：注册 IPC 与 autoUpdater 事件（只执行一次）。
 * dev 模式也注册 IPC（返回 state:'dev'），但不启动 autoUpdater / 不触发网络请求。
 */
function init() {
  if (initialized) return
  initialized = true
  if (app.isPackaged && !isPortable) wireAutoUpdaterEvents()
  ipcMain.handle('app:checkUpdate', handleCheckUpdate)
  ipcMain.handle('app:downloadUpdate', handleDownloadUpdate)
  ipcMain.handle('app:quitAndInstall', handleQuitAndInstall)
}

/** 启动后延迟自动检查（dev / 非打包不启用）。 */
function startAutoCheck() {
  if (!app.isPackaged) return
  setTimeout(() => {
    if (isPortable) {
      // 便携版：静默查 GitHub，有新版本才提示
      checkPortable(true)
    } else if (!checking) {
      checking = true
      autoUpdater.checkForUpdates().finally(() => {
        checking = false
      })
    }
  }, CHECK_DELAY_MS)
}

module.exports = { init, setWindow, startAutoCheck }