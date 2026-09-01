// ============================================================
// bootstrap.ts —— 依赖组装（原 index.ts loadDeps 拆出）
// 组装真实依赖（store/providers/tools/auth/core/memory/mcp）；
// 模块缺失时回落内存 stub，保证骨架可跑
// 中文注释、英文标识符
// ============================================================

import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { userPluginsDir, userExternalToolsDir } from './paths'

import type {
  EventHub,
  HistoryEvent,
  OutboundFrame,
  RpcHandlerContext,
  SecretsStore,
  SessionEngine,
  SessionRecord,
} from './types'

/** 内存 stub：模块未就绪时的兜底，session.list 返回空数组 */
function stubDeps(): {
  engine: SessionEngine
  approver: RpcHandlerContext['approver']
  secrets: SecretsStore
} {
  const sessions = new Map<string, SessionRecord>()

  const engine: SessionEngine = {
    create(cwd: string): SessionRecord {
      const now = Date.now()
      const rec: SessionRecord = {
        id: randomUUID(),
        cwd,
        label: '对话',
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        createdAt: now,
        lastActiveAt: now,
      }
      sessions.set(rec.id, rec)
      return rec
    },
    prompt(): { accepted: boolean } {
      return { accepted: true }
    },
    interrupt(): { ok: boolean } {
      return { ok: true }
    },
    history(): { events: { event: HistoryEvent }[] } {
      return { events: [] }
    },
    selectModel(): { ok: boolean } {
      return { ok: true }
    },
    list(): SessionRecord[] {
      return [...sessions.values()]
    },
    rename(): { ok: boolean } {
      return { ok: true }
    },
    fork(sessionId: string): SessionRecord {
      const src = sessions.get(sessionId)
      if (!src) throw new Error(`session not found: ${sessionId}`)
      const now = Date.now()
      const rec: SessionRecord = { ...src, id: randomUUID(), createdAt: now, lastActiveAt: now }
      sessions.set(rec.id, rec)
      return rec
    },
    delete(sessionId: string): { ok: boolean } {
      return { ok: sessions.delete(sessionId) }
    },
  }

  const approver: RpcHandlerContext['approver'] = {
    request: async () => 'rejected',
    respond: () => false,
  }

  const secrets: SecretsStore = {
    get: () => undefined,
    has: () => false,
    describe: (refs) => refs.map((ref) => ({ ref, configured: false, source: null })),
    set: () => {},
    remove: () => {},
  }

  return { engine, approver, secrets }
}

/** 组装真实依赖；模块缺失时回落 stub（异步：插件扫描加载需要 await） */
export async function bootstrap(hub: EventHub): Promise<{
  engine: SessionEngine
  approver: RpcHandlerContext['approver']
  secrets: SecretsStore
  ops?: RpcHandlerContext['ops']
  // M4：健康调度清理句柄（stub 模式下不存在）
  healthStop?: () => void
}> {
  try {
    // 并行 agent 交付的真实组装（store/providers/tools/auth/core/memory/mcp）
    // require 返回 any，缺失模块不会造成类型错误
    const dataDir =
      process.env.KOTONOHA_DATA_DIR || path.join(__dirname, '..', 'data')
    const { openDb } = require('./store/db') as { openDb: (dir: string) => unknown }
    const { openSecrets } = require('./store/secrets') as {
      openSecrets: (dir: string) => SecretsStore
    }
    const { buildDefaultAuth } = require('./auth') as {
      buildDefaultAuth: (secrets: SecretsStore, broadcast: (frame: OutboundFrame) => void) => {
        engine: import('./auth/types').AuthEngine
        permissionEngine: import('./auth/permission').PermissionEngine
        rulesManager: import('./auth/rules').RulesManager
        defaultRules: readonly import('./auth/types').PermissionRule[]
      }
    }
    const { createEngine } = require('./core/engine') as {
      createEngine: (deps: unknown, opts: { dataDir: string; extraHooks?: import('./tools/hooks').Hook[] }) => SessionEngine
    }
    const { buildDefaultRegistry } = require('./providers/registry') as {
      buildDefaultRegistry: (getKey: (ref: string) => string | undefined) => {
        get: (id: string) => unknown
        list: () => unknown[]
        defaultId: () => string
      }
    }
    const { buildDefaultTools, ToolRegistry } = require('./tools/registry') as {
      buildDefaultTools: () => import('./tools').Tool[]
      ToolRegistry: new () => import('./tools/registry').ToolRegistry
    }
    const { listToolsets, validateToolsetNames, DEFAULT_ACTIVE_TOOLSETS } = require('./tools/toolsets') as {
      listToolsets: () => { name: string; description: string; tools: string[] }[]
      validateToolsetNames: (names: string[]) => string[]
      DEFAULT_ACTIVE_TOOLSETS: readonly string[]
    }
    const { createSkillTool } = require('./tools/skills') as {
      createSkillTool: (db: unknown) => import('./types').Tool
    }
    const { buildSystemPrompt } = require('./core/context') as {
      buildSystemPrompt: (
        session: SessionRecord,
        cwdNote?: string,
        dataDir?: string,
        bondLevel?: number
      ) => string
    }
    const { getBondView } = require('./store/bond') as {
      getBondView: (db: import('./store').Db) => import('./store/bond').BondView
    }
    const { buildDefaultStore } = require('./store') as {
      buildDefaultStore: (dir: string, envSecret?: string) => import('./store').SessionStore
    }
    const { compressSessionStore } = require('./store') as {
      compressSessionStore: (
        db: import('./store').Db,
        sessionId: string,
        opts: { keepRecent: number; summarizeModel: string; maxTokens: number },
        provider: import('./providers').ModelProvider
      ) => Promise<{ originalEvents: number; compressedEvents: number; summary: string }>
    }
    const { buildDefaultMCP } = require('./mcp') as {
      buildDefaultMCP: (cwd?: string) => import('./mcp').MCPManager
    }
    const { getTotalCost, getSessionCost, exportAllCostCsv } = require('./store/cost') as {
      getTotalCost: (db: import('./store').Db) => {
        totalCostUsd: number
        totalTokens: number
        bySession: Record<string, { sessionId: string; tokens: number; costUsd: number }>
      }
      getSessionCost: (db: import('./store').Db, sessionId: string) => {
        sessionId: string
        records: unknown[]
        tokens: { prompt: number; completion: number }
        costUsd: number
      }
      exportAllCostCsv: (db: import('./store').Db) => string
    }
    const { listDegradations } = require('./store/degradations') as {
      listDegradations: (db: import('./store').Db) => import('./types').DegradationEntry[]
    }
    const { HealthMonitor } = require('./providers/health') as {
      HealthMonitor: new (
        registry: import('./providers').ProviderRegistry
      ) => {
        checkAll: () => Promise<{ id: string; ok: boolean }[]>
        isHealthy: (id: string) => boolean
        getStatus: () => { id: string; name: string; healthy: boolean }[]
        start: (intervalMs?: number) => void
        stop: () => void
      }
    }
    const { searchEvents } = require('./store/search') as {
      searchEvents: (
        db: import('./store').Db,
        sessionId: string,
        query: string,
        limit?: number
      ) => { id: number; sessionId: string; seq: number; payload: unknown; snippet?: string }[]
    }
    const { getTrajectory } = require('./tools/hooks') as {
      getTrajectory: (
        db: import('./store').Db,
        sessionId: string
      ) => { ts: number; tool: string; args: string; ok: boolean; error?: string; sessionId: string }[]
    }
    const { loadPlugins } = require('./tools/plugins/loader') as {
      loadPlugins: (
        dir: string
      ) => Promise<{
        tools: import('./tools/protocol').ExtendedTool[]
        hooks: import('./tools/hooks').Hook[]
        errors: { name: string; error: string }[]
      }>
    }
    const { loadExternalTools } = require('./tools/external') as {
      loadExternalTools: (
        dir: string
      ) => Promise<{
        tools: import('./tools/protocol').ExtendedTool[]
        errors: { file: string; error: string }[]
      }>
    }

    const db = openDb(dataDir) as import('./store').Db
    const secrets = openSecrets(dataDir)
    const store = buildDefaultStore(dataDir)
    const auth = buildDefaultAuth(secrets, (frame) => hub.broadcast(frame))
    const providers = buildDefaultRegistry((ref) => secrets.get(ref)) as import('./providers').ProviderRegistry
    // M4：Provider 健康监控（内存可用状态；不可用者从降级链临时剔除）
    const health = new HealthMonitor(providers)
    // 注册表实例：list({checkCtx})/listAvailable/get 满足 EngineDeps.tools 契约（check_fn 门控）
    const registry = new ToolRegistry()
    registry.registerAll(buildDefaultTools(), { source: 'default' })
    // execute_skill 换成带 db 的版本（内置 polish/storybeat + approved 自定义技能）
    registry.register(createSkillTool(db), { source: 'default', allowOverride: true })
    const tools = registry.list()

    // T3-plugins + E-userplug：扫描加载插件——先项目内（src/tools/plugins 开发期 /
    // dist/tools/plugins 编译后），后用户级（~/.kotonoha/plugins/，KOTONOHA_HOME 可覆盖）
    // 用户级放编译好的 JS 插件（TS 需先编译）；目录不存在 → loadPlugins 返回空结果
    // 合并策略「先到先得」：项目内可信度优先，用户级同名工具跳过并 warn
    // 错误隔离：loadPlugins 内部已隔离单个插件失败，此处仅做工具重名保护
    const pluginDir = path.join(__dirname, 'tools', 'plugins')
    const pluginSources: { userLevel: boolean; dir: string }[] = [
      { userLevel: false, dir: pluginDir },
      { userLevel: true, dir: userPluginsDir() },
    ]
    const pluginHooks: import('./tools/hooks').Hook[] = []
    for (const src of pluginSources) {
      const loaded = await loadPlugins(src.dir)
      for (const pt of loaded.tools) {
        if (tools.some((t) => t.def.name === pt.def.name)) {
          console.warn(
            src.userLevel
              ? `[plugins] 用户级插件 ${pt.def.name} 与内置重名，已跳过`
              : `[plugins] 工具「${pt.def.name}」与现有工具重名，跳过该插件工具`
          )
          continue
        }
        tools.push(pt)
      }
      // 钩子直接合并（两目录共存，不查重——与既有单目录行为一致）
      pluginHooks.push(...loaded.hooks)
    }
    const plugins = { hooks: pluginHooks }

    const mcp = buildDefaultMCP()

    // T2-external + E-userplug：配置驱动外接工具（tool.yaml → shell/HTTP 工具，不写核心代码）
    // 配置目录：项目内 <agent>/tools/external + 用户级 ~/.kotonoha/tools/（*.tools.yaml）
    // 目录不存在 → 空；合并策略同插件「先到先得」：项目内优先，用户级重名跳过并 warn
    // 错误隔离：loadExternalTools 内部已隔离单个文件失败，此处仅做工具重名保护
    const externalDir = path.join(__dirname, '..', 'tools', 'external')
    const externalSources: { userLevel: boolean; dir: string }[] = [
      { userLevel: false, dir: externalDir },
      { userLevel: true, dir: userExternalToolsDir() },
    ]
    for (const src of externalSources) {
      const external = await loadExternalTools(src.dir)
      for (const et of external.tools) {
        if (tools.some((t) => t.def.name === et.def.name)) {
          console.warn(
            src.userLevel
              ? `[external] 用户级工具 ${et.def.name} 与内置重名，已跳过`
              : `[external] 工具「${et.def.name}」与现有工具重名，跳过该外接工具`
          )
          continue
        }
        tools.push(et)
      }
    }

    const ops: RpcHandlerContext['ops'] = {
      listTools: () => tools.map((t) => ({ name: t.def.name, description: t.def.description })),
      listProviders: async () =>
        Promise.all(
          providers.list().map(async (p) => ({
            id: p.id,
            name: p.name,
            capabilities: (p as import('./providers').ModelProvider).capabilities,
            models: await p.listModels(),
          }))
        ),
      providerDefaultId: () => providers.defaultId(),
      exportSession: (id, format) => store.exportSession(id, format),
      importSession: async (data, format) => {
        const rec = await store.importSession(data, format)
        return { sessionId: rec.id }
      },
      compressSession: async (id, opts) => {
        const provider = providers.get(providers.defaultId())
        if (!provider) throw new Error('无可用 provider')
        return compressSessionStore(db, id, {
          keepRecent: opts.keepRecent,
          summarizeModel: 'deepseek-v4-flash',
          maxTokens: 4096,
        }, provider)
      },
      archiveSession: (id) => store.archiveSession(id),
      unarchiveSession: (id) => store.unarchiveSession(id),
      listArchivedSessions: () => store.listArchivedSessions(),
      isSessionArchived: (id) => store.isArchived(id),
      getRules: () => auth.engine.getRules().map((r) => ({ tool: r.tool, level: r.level })),
      setRules: (rules) => {
        auth.engine.setRules(rules)
      },
      listMcpServers: () =>
        mcp.listServers().map((s) => ({
          id: s.id,
          type: s.config.type,
          status: s.status,
          tools: s.tools.map((t) => t.def.name),
        })),
      // T1-toolsets：工具集门类（list / active / set，会话级持久化到 db）
      listToolsets: () => listToolsets(),
      getActiveToolsets: (id) => {
        const rec = db.getSession(id)
        if (!rec) throw new Error('会话不存在')
        return rec.toolsets ?? [...DEFAULT_ACTIVE_TOOLSETS]
      },
      setActiveToolsets: (id, names) => {
        const rec = db.getSession(id)
        if (!rec) throw new Error('会话不存在')
        // 未知集名剔除；空集合法（模型将收不到任何工具 schema，属用户显式选择）
        db.updateSession(id, { toolsets: validateToolsetNames(names) })
      },
      // C-memory2：语义记忆 + 程序性技能（走 db 已就绪接口）
      listMemories: (sessionId?: string) =>
        sessionId ? db.getMemoriesBySession(sessionId) : db.searchMemories('', 100),
      searchMemories: (query, limit) => db.searchMemories(query, limit),
      listSkills: (status) => db.getSkillsByStatus(status),
      approveSkill: (id) => {
        db.updateSkillStatus(id, 'approved')
        return db.getSkillById(id)
      },
      rejectSkill: (id) => {
        db.updateSkillStatus(id, 'rejected')
        return db.getSkillById(id)
      },
      // E-ops：成本统计 / 全文搜索 / 轨迹审计
      getSessionCost: (id) => getSessionCost(db, id),
      getTotalCost: () => getTotalCost(db),
      exportCostCsv: () => exportAllCostCsv(db),
      searchEvents: (sessionId, query, limit) => searchEvents(db, sessionId, query, limit),
      getTrajectory: (id) => getTrajectory(db, id),
      // M4：降级记录 / 供应商健康状态
      getDegradations: () => listDegradations(db),
      getProviderHealth: () => health.getStatus(),
      // v0.2.2 羁绊系统：好感度视图（bond.get）
      getBond: () => getBondView(db),
    }

    const engine = createEngine(
      {
        db,
        providers: {
          get: (id: string) => providers.get(id),
          list: () => providers.list(),
          defaultId: () => providers.defaultId(),
          // M4：降级链 + 健康状态注入（agent.ts 据此构建降级链）
          getFallbackChain: () => providers.getFallbackChain(),
          isHealthy: (id: string) => health.isHealthy(id),
        },
        tools: registry,
        approver: auth.engine,
        secrets,
        broadcast: (frame: OutboundFrame) => hub.broadcast(frame),
        // 羁绊语气进化：每次组装 system prompt 前先读当前等级（等级变化下一次 turn 生效）
        systemPrompt: (session: SessionRecord) =>
          buildSystemPrompt(session, undefined, dataDir, getBondView(db).level),
      },
      { dataDir, extraHooks: plugins.hooks }
    )
    // M4：启动健康调度（立即跑一次 + 每 10 分钟），返回 stop 供关闭清理
    health.start(10 * 60 * 1000)
    return { engine, approver: auth.engine, secrets, ops, healthStop: () => health.stop() }
  } catch (e) {
    console.warn('[agent] 后端模块未就绪，以内存 stub 运行（骨架模式）:', (e as Error).message)
    return stubDeps()
  }
}
