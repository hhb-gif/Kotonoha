// ============================================================
// test-memory2.mjs —— C-memory2 三层记忆验收脚本（node 原生，零 npm 依赖）
// 前置：先运行 npx tsc（读取 dist 产物）
// 运行：node scripts/test-memory2.mjs（工作目录 agent/）
// 验收项：
//   1. recordMemory → searchMemories 命中
//   2. extractMemories 从示例文本提取候选记忆
//   3. considerSkillCapture → pending → approve → execute_skill 可用
// 中文注释、英文标识符
// ============================================================
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = (p) => path.join(AGENT_ROOT, 'dist', p)

// ---- 结果收集 ----
const results = []
function record(status, name, detail) {
  results.push({ status, name, detail })
  console.log(`[${status}] ${name}`)
  if (detail) console.log(`        ${detail}`)
}

// ---- 加载 dist 产物 ----
let openDb, semantic, autoskill, createSkillTool
try {
  ;({ openDb } = require(dist('store/db.js')))
  semantic = require(dist('memory/semantic.js'))
  autoskill = require(dist('memory/autoskill.js'))
  ;({ createSkillTool } = require(dist('tools/skills.js')))
} catch (e) {
  record('FATAL', '加载 dist 产物（先运行 npx tsc）', e.message)
  process.exitCode = 1
  process.exit(1)
}

// ============================================================
// T1 recordMemory → searchMemories 命中
// ============================================================
function testSemanticRecord() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-m2-sem-'))
  try {
    const db = openDb(dir)
    const sid = 'test-sem-1'

    semantic.recordMemory(db, sid, '用户', '喜欢', '写视觉小说脚本', 0.85)
    semantic.recordMemory(db, sid, '用户', '需要', '早睡不熬夜', 0.9)

    const hits = semantic.searchMemories(db, '视觉小说', 5)
    if (hits.length >= 1 && hits.some((m) => m.detail.includes('视觉小说'))) {
      record('PASS', 'T1 recordMemory → searchMemories 命中（视觉小说）')
    } else {
      record('FAIL', 'T1 recordMemory → searchMemories 命中', `hits=${JSON.stringify(hits)}`)
    }

    const all = semantic.getMemories(db, sid)
    if (all.length === 2) {
      record('PASS', `T1.2 getMemories 返回 ${all.length} 条会话记忆`)
    } else {
      record('FAIL', 'T1.2 getMemories 返回 2 条会话记忆', `actual=${all.length}`)
    }
    db.close()
  } catch (e) {
    record('FAIL', 'T1 recordMemory → searchMemories', e.message)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// T2 extractMemories 启发式提取
// ============================================================
function testExtractMemories() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-m2-ext-'))
  try {
    const db = openDb(dir)
    const sid = 'test-ext-1'

    const sample =
      '我以后总是先写测试再提交代码。' +
      '我还喜欢在周末写小说，希望故事有悬念。' +
      '我只需要咖啡。'

    const extracted = semantic.extractMemories(db, sid, sample)
    const details = extracted.map((m) => m.detail)
    const ok1 = extracted.some((m) => m.relation === '习惯' && /先写测试/.test(m.detail))
    const ok2 = extracted.some((m) => m.relation === '喜欢' && /写小说/.test(m.detail))
    const ok3 = extracted.some((m) => m.entity === '咖啡')

    if (ok1 && ok2 && ok3 && extracted.length >= 3) {
      record('PASS', `T2 extractMemories 提取 ${extracted.length} 条：${details.join(' / ')}`)
    } else {
      record('FAIL', 'T2 extractMemories 启发式提取', `extracted=${JSON.stringify(extracted)}`)
    }

    // 去重：同文本再提取一次 → 不重复入库
    const again = semantic.extractMemories(db, sid, sample)
    if (again.length === 0) {
      record('PASS', 'T2.2 extractMemories 去重（重复文本零新增）')
    } else {
      record('FAIL', 'T2.2 extractMemories 去重', `重复提取新增 ${again.length} 条`)
    }

    // 非记忆文本（无「我喜欢/需要…」模式）→ 零提取
    const noise = '请把代码重构一下，改成模块化结构，注意错误处理。'
    if (semantic.extractMemories(db, sid + '-noise', noise).length === 0) {
      record('PASS', 'T2.3 extractMemories 噪声文本零提取')
    } else {
      record('FAIL', 'T2.3 extractMemories 噪声文本零提取')
    }
    db.close()
  } catch (e) {
    record('FAIL', 'T2 extractMemories 启发式提取', e.message)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// T3 技能沉淀链路：considerSkillCapture → pending → approve → execute_skill
// ============================================================
async function testSkillLifecycle() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-m2-skill-'))
  try {
    const db = openDb(dir)
    const sid = 'test-skill-1'

    // 3.1 未达标（回复太短）→ 不沉淀
    const short = autoskill.considerSkillCapture(db, sid, '帮我写一段开场白', '好的，完成了。')
    if (short === null) {
      record('PASS', 'T3.1 considerSkillCapture 阈值门控（回复过短不沉淀）')
    } else {
      record('FAIL', 'T3.1 considerSkillCapture 阈值门控', `意外沉淀：${short.id}`)
    }

    // 3.2 达标 → 生成候选 SKILL.md（pending）
    const userText = '请帮我生成一个对话场景的开场白，要求不少于一百字，要有悬念感，验收标准是读起来不拖沓。'
    const assistantText =
      '好的，任务完成。首先我提取了你的场景设定和人物关系，然后搭建了开场冲突点，接着补全了氛围描写，最后检查了篇幅和悬念钩子。' +
      '最终开场白如下：雨夜的书店里，她终于找到了那本被藏起的日记。她翻开第一页的瞬间，灯熄了。' +
      '这个开场利用环境反差制造紧张感，结尾留白引发好奇。如果你觉得节奏合适，我可以再按这个套路写下一幕。'

    const captured = autoskill.considerSkillCapture(db, sid, userText, assistantText)
    if (captured && captured.status === 'pending') {
      record('PASS', `T3.2 considerSkillCapture → pending（${captured.name}）`)
    } else {
      record('FAIL', 'T3.2 considerSkillCapture → pending', `captured=${JSON.stringify(captured)}`)
      return
    }

    // SKILL.md 内容含四段式
    const mdOk =
      captured.content.includes('## Trigger') &&
      captured.content.includes('## Steps') &&
      captured.content.includes('## Acceptance')
    if (mdOk) {
      record('PASS', 'T3.2.1 SKILL.md 含 Trigger/Steps/Acceptance 四段式')
    } else {
      record('FAIL', 'T3.2.1 SKILL.md 四段式', captured.content.slice(0, 200))
    }

    // 3.3 listPendingSkills 可见
    const pending = autoskill.listPendingSkills(db)
    if (pending.some((s) => s.id === captured.id)) {
      record('PASS', `T3.3 listPendingSkills 可见（${pending.length} 条 pending）`)
    } else {
      record('FAIL', 'T3.3 listPendingSkills 可见', `pending=${JSON.stringify(pending)}`)
    }

    // 3.4 approve → 状态 approved
    const approved = autoskill.approveSkill(db, captured.id)
    if (approved && approved.status === 'approved' && approved.approved_at) {
      record('PASS', 'T3.4 approveSkill → approved（approved_at 落库）')
    } else {
      record('FAIL', 'T3.4 approveSkill → approved', JSON.stringify(approved))
    }

    // 3.5 execute_skill（带 db 版本）执行自定义技能
    const tool = createSkillTool(db)
    const ctx = { cwd: dir, sessionId: sid, approve: async () => 'allowed-once', emit: () => {} }
    const byName = await tool.run(ctx, { skill: captured.name })
    if (byName.ok && byName.output.includes('## Steps')) {
      record('PASS', 'T3.5 execute_skill 按技能名执行 approved 自定义技能（返回 SKILL.md 提示词）')
    } else {
      record('FAIL', 'T3.5 execute_skill 按技能名执行', `ok=${byName.ok} output=${JSON.stringify(byName.output).slice(0, 160)}`)
    }

    // 3.6 按触发词匹配也可执行
    const byTrigger = await tool.run(ctx, { skill: userText.slice(0, 8) })
    if (byTrigger.ok && byTrigger.output.includes('## Steps')) {
      record('PASS', 'T3.6 execute_skill 按触发词匹配执行')
    } else {
      record('FAIL', 'T3.6 execute_skill 按触发词匹配', `ok=${byTrigger.ok} output=${JSON.stringify(byTrigger.output).slice(0, 160)}`)
    }

    // 3.7 内置技能仍可用（polish）
    const polish = await tool.run(ctx, { skill: 'polish', args: '你好,世界' })
    if (polish.ok && polish.output.includes('你好，世界')) {
      record('PASS', 'T3.7 execute_skill 内置 polish 仍可用')
    } else {
      record('FAIL', 'T3.7 execute_skill 内置 polish', `ok=${polish.ok} output=${JSON.stringify(polish.output)}`)
    }

    // 3.8 reject 链路
    const captured2 = autoskill.considerSkillCapture(db, sid, '帮我写一首短诗', '可以，完成了。我为你写好了这首诗，主题是秋天的落叶与风，一共八行。先用风起营造氛围，再用落叶承接意象，最后以一句反问收尾，全篇押韵工整。')
    if (captured2) {
      const rejected = autoskill.rejectSkill(db, captured2.id)
      if (rejected && rejected.status === 'rejected') {
        record('PASS', 'T3.8 rejectSkill → rejected')
      } else {
        record('FAIL', 'T3.8 rejectSkill → rejected', JSON.stringify(rejected))
      }
    } else {
      record('FAIL', 'T3.8 rejectSkill → rejected', '第二技能未沉淀（长度不足）')
    }

    db.close()
  } catch (e) {
    record('FAIL', 'T3 技能沉淀链路', e.message)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// T4 injectMemoryContext 注入片段
// ============================================================
function testInjectMemory() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kotonoha-m2-inj-'))
  try {
    const db = openDb(dir)
    const sid = 'test-inj-1'
    semantic.recordMemory(db, sid, '用户', '喜欢', '写小说', 0.85)
    semantic.recordMemory(db, sid, '用户', '喜欢', '咖啡', 0.8)

    // 构造历史：最近一条用户消息提到「小说」
    const history = [
      {
        type: 'user/message',
        data: { source: { kind: 'user' }, content: [{ type: 'text', text: '我想继续写那篇小说的下一章' }] },
      },
    ]
    const fragment = semantic.injectMemoryContext(db, history, path.join(tmpdir(), 'novel-project'))
    const ok = fragment.includes('小说') && fragment.includes('关于') === false
    if (fragment.length > 0 && ok) {
      record('PASS', `T4 injectMemoryContext 注入相关记忆（${fragment.length} 字符）`)
    } else {
      record('FAIL', 'T4 injectMemoryContext 注入相关记忆', `fragment=${JSON.stringify(fragment)}`)
    }
    db.close()
  } catch (e) {
    record('FAIL', 'T4 injectMemoryContext', e.message)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// main
// ============================================================
async function main() {
  testSemanticRecord()
  testExtractMemories()
  await testSkillLifecycle().catch((e) => {
    record('FAIL', 'T3 技能沉淀链路（异步异常）', e.message)
  })
  testInjectMemory()

  const pass = results.filter((r) => r.status === 'PASS').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  console.log('')
  console.log('================== 汇总 ==================')
  console.log(`PASS: ${pass}   FAIL: ${fail}`)
  if (fail > 0) {
    console.log('FAIL 项：')
    for (const r of results) {
      if (r.status === 'FAIL') console.log(`  - ${r.name}  |  ${r.detail}`)
    }
  }
  console.log('===========================================')
  process.exitCode = fail > 0 ? 1 : 0
}

main().catch((e) => {
  record('FATAL', '脚本异常', e.stack || e.message)
  process.exitCode = 1
})