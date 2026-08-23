// ============================================================
// serve.ts —— MCP Server CLI 入口
// 运行方式：node dist/mcp/serve.js
// 通过 stdio 启动 Kotonoha MCP server，暴露 14 个内置工具
// ============================================================

import { startStdioServer } from './server'

async function main() {
  // 工作目录：优先使用 KOTONOHA_DATA_DIR，其次 process.cwd()
  const cwd = process.env.KOTONOHA_DATA_DIR ?? process.cwd()
  
  console.error(`[kotonoha-mcp] Starting MCP server on stdio`)
  console.error(`[kotonoha-mcp] Workspace: ${cwd}`)
  
  try {
    await startStdioServer(cwd)
  } catch (error) {
    console.error(`[kotonoha-mcp] Server error:`, error)
    process.exit(1)
  }
}

main()