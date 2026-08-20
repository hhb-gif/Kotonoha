// Preload：向渲染进程注入 dsh 地址（contextIsolation 下走 contextBridge）
// 渲染层 bridge.js 读取 window.__KOTONOHA_API_BASE__ / __KOTONOHA_WS_BASE__；
// 浏览器 dev 环境（vite proxy）不注入，走相对路径。
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('__KOTONOHA_API_BASE__', 'http://127.0.0.1:3080')
contextBridge.exposeInMainWorld('__KOTONOHA_WS_BASE__', 'ws://127.0.0.1:3080')
