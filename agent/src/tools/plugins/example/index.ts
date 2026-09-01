// ============================================================
// index.ts —— 示例插件（插件协议完整写法，作为文档）
//
// 插件 = 一个目录（plugin.yaml + index.ts），放在 agent/tools/plugins/<名>/ 下
// 用户不写核心代码即可加工具：只需实现 PluginModule 协议——
//   1. manifest：插件清单（与 plugin.yaml 一致即可，loader 以 yaml 为准）
//   2. register(ctx)：ctx.registerTool() / ctx.registerHook() 注册资源
//
// 支持两种导出形态：
//   具名导出（本示例）：export const manifest + export function register
//   默认导出：export default { manifest, register }
//
// 动态 import 由 loader 完成（开发期 index.ts 经 tsx、dist 期 index.js 经 node），
// 插件代码无需关心运行环境。
//
// 用户级安装（E-userplug / v0.2.3 5.4）：
//   把编译好的插件放到 ~/.kotonoha/plugins/<插件名>/（plugin.yaml + index.js），
//   bootstrap 启动时自动加载，无需改动项目源码。注意：
//   - 用户级放的是 JS（node 可直接 require），TS 插件需先用 tsc 等编译为 JS 再放入
//   - 与项目内插件/内置工具重名时「先到先得」——项目内优先，用户级同名工具
//     跳过并 console.warn（[plugins] 用户级插件 xx 与内置重名，已跳过）
//   - KOTONOHA_HOME 环境变量可重定向用户级根目录（仅供测试；生产用真实 homedir）
// 中文注释、英文标识符
// ============================================================

import type { Tool, ToolResult, ToolContext } from '../../../types'
import { createExtendedTool } from '../../protocol'
import type { PluginContext, PluginManifest } from '../types'

// ---- 1. 清单：与 plugin.yaml 一致（loader 以 yaml 为准，此处供模块自描述）----

export const manifest: PluginManifest = {
  name: 'example',
  version: '1.0.0',
  description: '示例插件：展示插件协议完整写法（ctx.registerTool）',
  tools: ['example_echo'],
}

// ---- 2. 工具本体：与内置工具同构（Tool 契约）----

/** example_echo：把输入的 text 原样回显（只读工具，无副作用） */
const echoTool: Tool = {
  def: {
    name: 'example_echo',
    description: '回显一段文本（示例插件工具）：原样返回输入 text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '要回显的文本',
        },
      },
      required: ['text'],
    },
  },
  async run(ctx: ToolContext, args: unknown): Promise<ToolResult> {
    // args 为模型传入的 JSON 参数对象；类型需自行断言（与内置工具一致）
    const text = (args as { text?: unknown } | null | undefined)?.text
    if (typeof text !== 'string') {
      return { ok: false, output: '', error: '参数 text 必须是字符串' }
    }
    // ctx 可用：cwd（会话工作目录）/ sessionId / emit（广播事件）/ approve（审批）
    return { ok: true, output: `echo: ${text}` }
  },
}

// ---- 3. 注册入口：loader 扫描到本目录后调用 ----
// ctx API：
//   ctx.registerTool(tool)  —— 注册工具。传 Tool（自动补协议字段）或
//                              ExtendedTool（完整控制 kind/group/readOnly/hooks）均可
//   ctx.registerHook(hook)  —— 注册钩子（before 拦截/改写 args，after 观测审计）
//   ctx.manifest            —— 本插件清单
//   ctx.cwd                 —— 本插件目录（绝对路径，读取插件资源文件用）

export function register(ctx: PluginContext): void {
  // 推荐方式：用 createExtendedTool 明确协议字段（可读性 + 并行调度判断依据）
  //   kind=builtin：内置类工具（复用现有执行/审批路径）
  //   group=plugin：插件组（toolsets 集 plugins:<name> 的成员）
  //   readOnly=true：只读 → 可并行执行、免审批
  ctx.registerTool(
    createExtendedTool(echoTool, {
      kind: 'builtin',
      group: 'plugin',
      readOnly: true,
    })
  )

  // 简化方式（不想要协议字段时）：直接注册基础 Tool，loader 自动补字段
  // ctx.registerTool(echoTool)
}