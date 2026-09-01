// ============================================================
// paths.ts —— 用户级目录解析（E-userplug / v0.2.3 5.4）
// 用户级扩展根目录约定：~/.kotonoha/
//   插件：~/.kotonoha/plugins/（每插件一个子目录：plugin.yaml + index.js）
//   外部工具：~/.kotonoha/tools/（*.tools.yaml）
// KOTONOHA_HOME 环境变量可覆盖根目录（仅供测试模拟临时 HOME；
// 生产环境走真实 homedir，函数每次调用时读取 env，切换即时生效）
// 中文注释、英文标识符
// ============================================================

import os from 'node:os'
import path from 'node:path'

/** 用户级 Kotonoha 根目录：~/.kotonoha/（KOTONOHA_HOME 覆盖仅用于测试） */
export function userKotonohaDir(): string {
  const override = process.env.KOTONOHA_HOME
  if (typeof override === 'string' && override.trim()) {
    return path.resolve(override.trim())
  }
  return path.join(os.homedir(), '.kotonoha')
}

/** 用户级插件目录：~/.kotonoha/plugins/（子目录内放 plugin.yaml + index.js） */
export function userPluginsDir(): string {
  return path.join(userKotonohaDir(), 'plugins')
}

/** 用户级外部工具目录：~/.kotonoha/tools/（放 *.tools.yaml 配置） */
export function userExternalToolsDir(): string {
  return path.join(userKotonohaDir(), 'tools')
}
