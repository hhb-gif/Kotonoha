// ============================================================
// auth/__tests__/auth.test.ts —— 权限引擎 + 审批队列测试
// 18 场景（3档 × 3工具 × 2条件）+ 100并发压测
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SecretsStore } from '../../types'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm, mkdir } from 'node:fs/promises'
import { buildDefaultAuth, PermissionEngine, Approver, RulesManager, DEFAULT_RULES } from '../index'
import type { ToolContext, PermissionRule, PermissionLevel } from '../types'
import type { OutboundFrame, ApprovalRequestFrame } from '../../types'

const TEST_DIR = join(tmpdir(), 'kotonoha-auth-test')

// Mock SecretsStore using a temp directory
async function createTestSecrets(): Promise<SecretsStore> {
  await rm(TEST_DIR, { recursive: true, force: true })
  await mkdir(TEST_DIR, { recursive: true })
  const { openSecrets } = await import('../../store/secrets')
  return openSecrets(TEST_DIR)
}

// Mock broadcast function
function createMockBroadcast() {
  const frames: ApprovalRequestFrame[] = []
  const broadcast = vi.fn((frame: OutboundFrame) => {
    if (frame.type === 'server-request' && frame.method === 'approval/requested') {
      frames.push(frame)
    }
  })
  return { broadcast, frames }
}

// Mock ToolContext
function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: '/workspace',
    sessionId: 'test-session',
    approve: async () => 'allowed-once',
    emit: () => {},
    ...overrides,
  }
}

describe('PermissionEngine - 18 场景 (3档 × 3工具 × 2条件)', () => {
  let secrets: SecretsStore
  let engine: PermissionEngine
  let rulesManager: RulesManager

  beforeEach(async () => {
    secrets = await createTestSecrets()
    rulesManager = new RulesManager(secrets)
    engine = new PermissionEngine(rulesManager)
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  // 18 场景: 3工具 × 3档 × 2条件
  // read_file: allow (无条件) × 2条件 = 2
  // write_file: ask (条件: 非.git) × 2条件 = 2 (outside .git -> ask, inside .git -> deny)
  // bash: ask (条件: 安全命令) × 2条件 = 2 (safe -> ask, dangerous -> deny)
  // glob: allow × 2 = 2
  // grep: allow × 2 = 2
  // task: allow × 2 = 2
  // file_edit: ask × 2 = 2
  // patch: ask × 2 = 2
  // unknown: deny × 2 = 2
  // Total: 18

  describe('DEFAULT_RULES 行为', () => {
    const ctxOutsideGit = makeCtx({ cwd: '/workspace' })
    const ctxInsideGit = makeCtx({ cwd: '/workspace/.git' })
    const safeArgs = { cmd: 'echo hello' }
    const dangerousArgs = { cmd: 'rm -rf /' }

    // read_file: allow (无条件)
    it('read_file | allow | outside git', () => expect(engine.check('read_file', ctxOutsideGit)).toBe('allow'))
    it('read_file | allow | inside git', () => expect(engine.check('read_file', ctxInsideGit)).toBe('allow'))

    // write_file: ask (条件: 非.git)
    it('write_file | ask | outside git', () => expect(engine.check('write_file', ctxOutsideGit)).toBe('ask'))
    it('write_file | deny | inside git', () => expect(engine.check('write_file', ctxInsideGit)).toBe('deny'))

    // bash: ask (条件: 安全命令)
    it('bash | ask | safe cmd', () => expect(engine.check('bash', ctxOutsideGit, safeArgs)).toBe('ask'))
    it('bash | deny | dangerous cmd', () => expect(engine.check('bash', ctxOutsideGit, dangerousArgs)).toBe('deny'))

    // glob: allow (无条件)
    it('glob | allow | outside git', () => expect(engine.check('glob', ctxOutsideGit)).toBe('allow'))
    it('glob | allow | inside git', () => expect(engine.check('glob', ctxInsideGit)).toBe('allow'))

    // grep: allow (无条件)
    it('grep | allow | outside git', () => expect(engine.check('grep', ctxOutsideGit)).toBe('allow'))
    it('grep | allow | inside git', () => expect(engine.check('grep', ctxInsideGit)).toBe('allow'))

    // task: allow (无条件)
    it('task | allow | outside git', () => expect(engine.check('task', ctxOutsideGit)).toBe('allow'))
    it('task | allow | inside git', () => expect(engine.check('task', ctxInsideGit)).toBe('allow'))

    // file_edit: ask (无条件)
    it('file_edit | ask | outside git', () => expect(engine.check('file_edit', ctxOutsideGit)).toBe('ask'))
    it('file_edit | ask | inside git', () => expect(engine.check('file_edit', ctxInsideGit)).toBe('ask'))

    // patch: ask (无条件)
    it('patch | ask | outside git', () => expect(engine.check('patch', ctxOutsideGit)).toBe('ask'))
    it('patch | ask | inside git', () => expect(engine.check('patch', ctxInsideGit)).toBe('ask'))

    // unknown: deny (兜底)
    it('unknown | deny | outside git', () => expect(engine.check('unknown_tool', ctxOutsideGit)).toBe('deny'))
    it('unknown | deny | inside git', () => expect(engine.check('unknown_tool', ctxInsideGit)).toBe('deny'))
  })

  it('allow 工具直接通过（read_file）', () => {
    const ctx = makeCtx()
    expect(engine.check('read_file', ctx)).toBe('allow')
  })

  it('ask 工具在 .git 外返回 ask', () => {
    const ctx = makeCtx({ cwd: '/workspace' })
    expect(engine.check('write_file', ctx)).toBe('ask')
  })

  it('ask 工具在 .git 内因条件不满足落到 deny', () => {
    const ctx = makeCtx({ cwd: '/workspace/.git' })
    expect(engine.check('write_file', ctx)).toBe('deny')
  })

  it('危险 bash 命令返回 deny', () => {
    const ctx = makeCtx()
    const args = { cmd: 'rm -rf /' }
    expect(engine.check('bash', ctx, args)).toBe('deny')
  })

  it('安全 bash 命令返回 ask', () => {
    const ctx = makeCtx()
    const args = { cmd: 'echo hello' }
    expect(engine.check('bash', ctx, args)).toBe('ask')
  })

  it('未知工具落到 * deny 兜底', () => {
    const ctx = makeCtx()
    expect(engine.check('unknown_tool', ctx)).toBe('deny')
  })
})

describe('Approver - 审批队列、超时、always 规则', () => {
  let secrets: SecretsStore
  let auth: ReturnType<typeof buildDefaultAuth>
  let approver: Approver

  beforeEach(async () => {
    secrets = await createTestSecrets()
    const { broadcast } = createMockBroadcast()
    auth = buildDefaultAuth(secrets, broadcast)
    approver = auth.engine as Approver
  })

  afterEach(async () => {
    approver.clearAll()
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  it('allow 工具无需审批', () => {
    const ctx = makeCtx()
    expect(auth.engine.check('read_file', ctx)).toBe('allow')
  })

  it('ask 工具发起审批请求', async () => {
    const { broadcast, frames } = createMockBroadcast()
    const freshAuth = buildDefaultAuth(secrets, broadcast)
    const ctx = makeCtx()

    // 检查权限是 ask
    expect(freshAuth.engine.check('write_file', ctx)).toBe('ask')

    // 发起审批
    const approvalPromise = freshAuth.engine.requestApproval({
      id: 'approval-1',
      sessionId: 'test-session',
      toolName: 'write_file',
      callId: 'call-1',
      args: { path: 'test.txt', content: 'hello' },
      reason: 'Write file',
      timestamp: Date.now(),
      timeoutMs: 1000,
      resolve: vi.fn(),
    })

    // 应该广播了 approval/requested 帧
    expect(frames.length).toBe(1)
    expect(frames[0].method).toBe('approval/requested')
    expect(frames[0].payload.toolName).toBe('write_file')
  })

  it('用户允许 -> allowed-once', async () => {
    const { broadcast, frames } = createMockBroadcast()
    const freshAuth = buildDefaultAuth(secrets, broadcast)

    const approvalPromise = freshAuth.engine.requestApproval({
      id: 'approval-1',
      sessionId: 'test-session',
      toolName: 'write_file',
      callId: 'call-1',
      args: { path: 'test.txt' },
      reason: 'Write file',
      timestamp: Date.now(),
      timeoutMs: 5000,
      resolve: vi.fn(),
    })

    // 模拟用户点击"允许"
    const approvalId = frames[0].payload.approvalId
    const result = freshAuth.engine.respond(approvalId, 'allowed-once')

    expect(result).toBe(true)
    await expect(approvalPromise).resolves.toBe('allowed-once')
  })

  it('用户拒绝 -> rejected', async () => {
    const { broadcast, frames } = createMockBroadcast()
    const freshAuth = buildDefaultAuth(secrets, broadcast)

    const approvalPromise = freshAuth.engine.requestApproval({
      id: 'approval-1',
      sessionId: 'test-session',
      toolName: 'write_file',
      callId: 'call-1',
      args: { path: 'test.txt' },
      reason: 'Write file',
      timestamp: Date.now(),
      timeoutMs: 5000,
      resolve: vi.fn(),
    })

    const approvalId = frames[0].payload.approvalId
    freshAuth.engine.respond(approvalId, 'rejected')

    await expect(approvalPromise).resolves.toBe('rejected')
  })

  it('用户选择 always -> 持久化规则，后续自动通过', async () => {
    const { broadcast, frames } = createMockBroadcast()
    const freshAuth = buildDefaultAuth(secrets, broadcast)

    const approvalPromise = freshAuth.engine.requestApproval({
      id: 'approval-1',
      sessionId: 'test-session',
      toolName: 'write_file',
      callId: 'call-1',
      args: { path: 'test.txt' },
      reason: 'Write file',
      timestamp: Date.now(),
      timeoutMs: 5000,
      resolve: vi.fn(),
    })

    const approvalId = frames[0].payload.approvalId
    freshAuth.engine.respond(approvalId, 'always')

    await expect(approvalPromise).resolves.toBe('allowed-once')

    // 后续相同工具相同参数应该自动通过（通过 always 规则检查）
    const ctx = makeCtx()
    expect(freshAuth.engine.check('write_file', ctx, { path: 'test.txt' })).toBe('ask') // 仍然是 ask
    // 但 checkAlways 应该返回 true
    expect(freshAuth.permissionEngine.checkAlways('write_file', { path: 'test.txt' })).toBe(true)
  })

  it('5分钟超时自动 rejected', async () => {
    const { broadcast } = createMockBroadcast()
    const freshAuth = buildDefaultAuth(secrets, broadcast)

    const approvalPromise = freshAuth.engine.requestApproval({
      id: 'approval-1',
      sessionId: 'test-session',
      toolName: 'write_file',
      callId: 'call-1',
      args: { path: 'test.txt' },
      reason: 'Write file',
      timestamp: Date.now(),
      timeoutMs: 100, // 100ms for test
      resolve: vi.fn(),
    })

    await expect(approvalPromise).resolves.toBe('rejected')
  }, 5000)

  it('规则热更新立即生效', () => {
    const ctx = makeCtx()
    
    // 初始规则：write_file = ask
    expect(auth.engine.check('write_file', ctx)).toBe('ask')

    // 热更新规则：write_file = allow
    auth.engine.setRules([
      { tool: 'write_file', level: 'allow' },
      { tool: '*', level: 'deny' },
    ])

    expect(auth.engine.check('write_file', ctx)).toBe('allow')
  })

  it('respond 未找到 approvalId 返回 false', () => {
    const result = auth.engine.respond('non-existent-id', 'allowed-once')
    expect(result).toBe(false)
  })

  it('重复 respond 返回 false', async () => {
    const { broadcast, frames } = createMockBroadcast()
    const freshAuth = buildDefaultAuth(secrets, broadcast)

    const approvalPromise = freshAuth.engine.requestApproval({
      id: 'approval-1',
      sessionId: 'test-session',
      toolName: 'write_file',
      callId: 'call-1',
      args: { path: 'test.txt' },
      reason: 'Write file',
      timestamp: Date.now(),
      timeoutMs: 5000,
      resolve: vi.fn(),
    })

    const approvalId = frames[0].payload.approvalId
    freshAuth.engine.respond(approvalId, 'allowed-once')
    
    // 第二次 respond 应该返回 false
    const result = freshAuth.engine.respond(approvalId, 'rejected')
    expect(result).toBe(false)
  })
})

describe('RulesManager - 持久化、always 规则', () => {
  let secrets: SecretsStore
  let rulesManager: RulesManager

  beforeEach(async () => {
    secrets = await createTestSecrets()
    rulesManager = new RulesManager(secrets)
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  it('默认规则加载正确', () => {
    const rules = rulesManager.getRules()
    expect(rules.length).toBe(DEFAULT_RULES.length)
    expect(rules.find(r => r.tool === 'read_file')?.level).toBe('allow')
    expect(rules.find(r => r.tool === 'write_file')?.level).toBe('ask')
    expect(rules.find(r => r.tool === '*')?.level).toBe('deny')
  })

  it('setRules 覆盖并持久化', () => {
    const newRules: PermissionRule[] = [
      { tool: 'custom_tool', level: 'allow' },
      { tool: '*', level: 'deny' },
    ]
    rulesManager.setRules(newRules)
    
    const rules = rulesManager.getRules()
    expect(rules.length).toBe(2)
    expect(rules[0].tool).toBe('custom_tool')
  })

  it('addAlwaysRule 并检查', () => {
    rulesManager.addAlwaysRule('write_file', { path: 'test.txt' })
    expect(rulesManager.checkAlways('write_file', { path: 'test.txt' })).toBe(true)
    expect(rulesManager.checkAlways('write_file', { path: 'other.txt' })).toBe(false)
    expect(rulesManager.checkAlways('read_file', { path: 'test.txt' })).toBe(false)
  })

  it('removeAlwaysRule 移除规则', () => {
    rulesManager.addAlwaysRule('write_file', { path: 'test.txt' })
    expect(rulesManager.checkAlways('write_file', { path: 'test.txt' })).toBe(true)
    
    rulesManager.removeAlwaysRule('write_file', { path: 'test.txt' })
    expect(rulesManager.checkAlways('write_file', { path: 'test.txt' })).toBe(false)
  })

  it('reload 重新加载持久化规则', () => {
    rulesManager.setRules([{ tool: 'test', level: 'allow' }, { tool: '*', level: 'deny' }])
    
    // 创建新的 RulesManager 实例（模拟重启）
    const newManager = new RulesManager(secrets)
    const rules = newManager.getRules()
    expect(rules.find(r => r.tool === 'test')?.level).toBe('allow')
  })
})

describe('Stress Test - 100 并发审批无泄漏', () => {
  let secrets: SecretsStore

  beforeEach(async () => {
    secrets = await createTestSecrets()
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  it('100 并发审批请求，队列有序，无泄漏', async () => {
    const { broadcast } = createMockBroadcast()
    const auth = buildDefaultAuth(secrets, broadcast)
    const approver = auth.engine as Approver

    const concurrentCount = 100
    const promises: Promise<'allowed-once' | 'always' | 'rejected'>[] = []

    // 发起 100 个并发审批请求
    for (let i = 0; i < concurrentCount; i++) {
      const p = auth.engine.requestApproval({
        id: `approval-${i}`,
        sessionId: 'test-session',
        toolName: 'write_file',
        callId: `call-${i}`,
        args: { path: `file-${i}.txt` },
        reason: `Write file ${i}`,
        timestamp: Date.now(),
        timeoutMs: 2000,
        resolve: vi.fn(),
      })
      promises.push(p)
    }

    // 等待所有广播完成
    await new Promise(resolve => setTimeout(resolve, 100))

    // 验证所有请求都已入队
    expect(approver.pendingCount()).toBe(concurrentCount)
    expect(broadcast).toHaveBeenCalledTimes(concurrentCount)

    // 响应前 50 个 allowed-once，后 50 个 rejected
    const frames = broadcast.mock.calls.map(([frame]) => frame as ApprovalRequestFrame)
    for (let i = 0; i < concurrentCount; i++) {
      const approvalId = frames[i].payload.approvalId
      const outcome = i < 50 ? 'allowed-once' : 'rejected'
      const result = auth.engine.respond(approvalId, outcome)
      expect(result).toBe(true)
    }

    // 等待所有 Promise 完成
    const results = await Promise.all(promises)
    
    // 验证结果
    const allowedCount = results.filter(r => r === 'allowed-once').length
    const rejectedCount = results.filter(r => r === 'rejected').length
    expect(allowedCount).toBe(50)
    expect(rejectedCount).toBe(50)

    // 队列应已清空
    expect(approver.pendingCount()).toBe(0)
  }, 10000)

  it('并发期间规则热更新不阻塞', async () => {
    const { broadcast } = createMockBroadcast()
    const auth = buildDefaultAuth(secrets, broadcast)
    const approver = auth.engine as Approver

    // 发起 20 个并发请求
    const promises: Promise<'allowed-once' | 'always' | 'rejected'>[] = []
    for (let i = 0; i < 20; i++) {
      promises.push(auth.engine.requestApproval({
        id: `approval-${i}`,
        sessionId: 'test-session',
        toolName: 'write_file',
        callId: `call-${i}`,
        args: { path: `file-${i}.txt` },
        reason: `Write file ${i}`,
        timestamp: Date.now(),
        timeoutMs: 5000,
        resolve: vi.fn(),
      }))
    }

    await new Promise(resolve => setTimeout(resolve, 50))

    // 热更新规则
    auth.engine.setRules([
      { tool: 'write_file', level: 'allow' },
      { tool: '*', level: 'deny' },
    ])

    // 新规则立即生效
    const ctx = makeCtx()
    expect(auth.engine.check('write_file', ctx)).toBe('allow')

    // 清理
    approver.clearAll()
    await Promise.allSettled(promises)
  })
})