// src/bridge/update.js
// 更新能力桥接：包一层 preload 注入的 window.__KOTONOHA_UPDATE__。
// 浏览器 dev 环境（vite，无 preload）不存在该对象 → 视为「不支持更新」，设置面板隐藏相关操作。
const api =
  typeof window !== 'undefined' && window.__KOTONOHA_UPDATE__ ? window.__KOTONOHA_UPDATE__ : null

/** 当前环境是否具备更新能力（仅 Electron 窗口；浏览器 dev 为 false）。 */
export function updateCapable() {
  return !!api
}

/** 手动触发更新检查。 */
export async function checkUpdate() {
  if (!api) return { ok: false, error: '当前环境不支持自动更新' }
  return api.checkUpdate()
}

/** 下载更新（NSIS 自动下载 / portable 打开 Release 页）。 */
export async function downloadUpdate() {
  if (!api) return { ok: false, error: '当前环境不支持自动更新' }
  return api.downloadUpdate()
}

/** 重启并安装（仅 NSIS 下载完成后可用）。 */
export async function quitAndInstall() {
  if (!api) return { ok: false, error: '当前环境不支持自动更新' }
  return api.quitAndInstall()
}

/** 订阅主进程 update:status 事件（返回取消订阅函数）。 */
export function onUpdateStatus(cb) {
  if (!api) return () => {}
  return api.onStatus(cb)
}