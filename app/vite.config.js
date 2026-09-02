import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// 读取 package.json 版本注入前端（footer 显示真实版本，便于确认自动更新是否生效）
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// 本地开发配置；/api 代理到 agent harness（3080）
// 关键：浏览器请求带 Origin: http://127.0.0.1:5173，后端有 Origin/Host 信任校验会返回
// forbidden。这里把 Origin 重写为后端自身的 loopback 源，绕过校验（同源伪装）。
// base './'：构建产物用相对路径，Electron 打包后以 file:// 加载 dist/index.html。
export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3080',
        changeOrigin: true,
        ws: true,
        headers: { Origin: 'http://127.0.0.1:3080' },
      },
    },
  },
})
