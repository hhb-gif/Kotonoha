// Electron 主进程（Kotonoha 桌面壳）
// 未打包（electron .）时加载 vite dev server；打包后加载 dist/index.html。
// 页面与 dsh 的通信走 HTTP/WS 直连 127.0.0.1:3080，由 preload 注入地址。
const { app, BrowserWindow } = require('electron')
const path = require('path')

const DEV_URL = process.env.KOTONOHA_DEV_URL || 'http://127.0.0.1:5173'

let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0a0812',
    autoHideMenuBar: true,
    title: 'Kotonoha',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    win.loadURL(DEV_URL)
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
