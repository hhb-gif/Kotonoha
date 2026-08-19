import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 本地开发配置；/api 代理到 dsh（3080）
// 关键：浏览器请求带 Origin: http://127.0.0.1:5173，dsh 有 Origin/Host 信任校验会返回
// forbidden。这里把 Origin 重写为 dsh 自身的 loopback 源，绕过校验（同源伪装）。
export default defineConfig({
  plugins: [react()],
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