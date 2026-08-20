// ============================================================
// skills.js —— Agent 技能目录与调控
//
// 把 dsh 的工具能力包装为视觉小说里的「技能/道具」，UI 开关控制：
//   - 软层：发送 prompt 时按关闭项注入约束段（引导模型不调用）
//   - 硬层：监听 approval/requested（越界工具调用审批），关闭的技能自动拒绝，
//           approval 技能控制越界审批的自动放行/拒绝（实测依据见 docs/records/approval-probe-2026-08-20.md）
// 工作区内合法调用 dsh 不触发审批（硬限制），不受开关影响。
// ============================================================

const SKILLS_KEY = 'kotonoha:skills'

// 技能目录：id 稳定、name 展示名、icon 图标字符、desc 描述、tools 关联的 dsh 工具名
const SKILL_CATALOG = [
  {
    id: 'file-read',
    name: '文献读取',
    icon: '📖',
    desc: '读取项目文件与资料（read / fs.read）',
    tools: ['read', 'fs.read', 'fs/read', 'grep', 'glob', 'fs/list'],
  },
  {
    id: 'file-write',
    name: '文书撰写',
    icon: '✏️',
    desc: '创建、编辑项目文件（write / fs.write）',
    tools: ['write', 'fs.write', 'fs/write', 'edit', 'fs.edit'],
  },
  {
    id: 'terminal',
    name: '终端术式',
    icon: '⌨️',
    desc: '执行终端命令（bash / pwsh / cmd）',
    tools: ['bash', 'pwsh', 'powershell', 'cmd', 'terminal', 'shell'],
  },
  {
    id: 'search',
    name: '检索之眼',
    icon: '🔍',
    desc: '代码与内容检索（grep / glob / search）',
    tools: ['grep', 'glob', 'search', 'rg'],
  },
  {
    id: 'web',
    name: '异界探访',
    icon: '🌐',
    desc: '网页检索与内容抓取（websearch / webfetch）',
    tools: ['websearch', 'webfetch', 'web', 'fetch', 'http'],
  },
  {
    id: 'skill',
    name: '奥义执行',
    icon: '⚡',
    desc: '执行预置技能包（skill / workflow）',
    tools: ['skill', 'workflow', 'spawn', 'subagent'],
  },
  {
    id: 'approval',
    name: '越界放行',
    icon: '🛡️',
    desc: '沙箱越界操作（如写工作区外文件）的审批策略：开=自动放行，关=自动拒绝',
    tools: [], // 特殊技能：不绑定工具名，作用于审批策略本身
  },
]

const DEFAULT_STATE = {
  'file-read': true,
  'file-write': true,
  terminal: true,
  search: true,
  web: true,
  skill: true,
  approval: true, // 默认自动放行越界审批，保持当前无感体验
}

// ---- 状态读写 ----
export function getSkillState() {
  const merged = { ...DEFAULT_STATE }
  try {
    const raw = localStorage.getItem(SKILLS_KEY)
    if (raw) Object.assign(merged, JSON.parse(raw))
  } catch (err) {
    console.error('[skills] read state failed:', err)
  }
  for (const s of SKILL_CATALOG) if (typeof merged[s.id] !== 'boolean') merged[s.id] = DEFAULT_STATE[s.id] !== false
  return merged
}

export function setSkillState(id, on) {
  const next = { ...getSkillState(), [id]: !!on }
  try {
    localStorage.setItem(SKILLS_KEY, JSON.stringify(next))
  } catch (err) {
    console.error('[skills] write state failed:', err)
  }
  return next
}

export function resetSkills() {
  try {
    localStorage.removeItem(SKILLS_KEY)
  } catch (err) {
    console.error('[skills] reset failed:', err)
  }
  return getSkillState()
}

export function getSkillCatalog() {
  return SKILL_CATALOG
}

// ---- 工具 → 技能 ----
/** 工具名映射到技能定义（带 normalize：去掉命名空间前缀、大小写不敏感）。 */
export function skillOfTool(toolName) {
  const t = String(toolName || '').toLowerCase()
  const bare = t.split('/').pop().split(':').pop()
  for (const s of SKILL_CATALOG) {
    if (s.tools.some((x) => x.toLowerCase() === bare)) return s
  }
  return null
}

// ---- 软层：prompt 约束段 ----
/** 根据当前开关状态生成发送前的约束提示词段（只列关闭的技能）。 */
export function buildConstraintSegment(state) {
  const off = SKILL_CATALOG.filter((s) => s.id !== 'approval' && state && state[s.id] === false)
  if (off.length === 0) return null
  const names = off.map((s) => `「${s.name}」(${s.tools[0] || s.id})`).join('、')
  return `[系统约束] 本次对话中，以下技能已被用户禁用：${names}。你不得调用这些工具，也不得用其他工具间接实现等效功能。如果用户的需求只能用被禁技能完成，请明确告知用户该技能已禁用，并给出替代建议。`
}

// ---- 硬层：审批决策 ----
/**
 * 判定一次越界工具调用的审批结果。
 * @param {object} state     当前技能状态
 * @param {string} toolName  审批请求里的工具名
 * @returns {'allow'|'deny'}
 *   - 工具命中某技能且该技能关闭 → deny（技能硬关）
 *   - approval 关闭 → deny（严格模式：越界一律拒绝）
 *   - 否则 → allow（自动放行越界）
 */
export function decideApproval(state, toolName) {
  const skill = skillOfTool(toolName)
  if (skill && skill.id !== 'approval' && state[skill.id] === false) return 'deny'
  if (state.approval === false) return 'deny'
  return 'allow'
}

export default {
  getSkillState,
  setSkillState,
  resetSkills,
  getSkillCatalog,
  skillOfTool,
  buildConstraintSegment,
  decideApproval,
}