// panels/SkillsPanel.jsx —— 技能页签：工具集切换 + 技能目录 + 后端工具目录
//   + 待批准/已批准技能（审批）+ 语义记忆
// 自包含：工具集（toolsets.list/active/set）、工具目录（tools.list）、
//   技能列表（skills.list + approve/reject）、记忆（memory.list）的加载与操作
import { useCallback, useEffect, useState } from 'react'
import bridge from '../../bridge/bridge'
import { ToolSourceBadge } from './shared'

export default function SkillsPanel({ active, context, skills = {}, skillCatalog = [], onToggleSkill, showMsg }) {
  // 后端工具目录（tools.list）+ 启停占位
  const [tools, setTools] = useState(null)
  const [toolsLoading, setToolsLoading] = useState(false)
  const [toolToggles, setToolToggles] = useState({})
  // 工具集切换（toolsets.list / active / set）
  const [toolsets, setToolsets] = useState([])
  const [activeToolsets, setActiveToolsets] = useState([])
  const [toolsetsLoading, setToolsetsLoading] = useState(false)
  // 后端技能列表（skills.list：pending 待批准 / approved 已批准）
  const [skillList, setSkillList] = useState(null)
  const [skillListLoading, setSkillListLoading] = useState(false)
  const [skillActionBusy, setSkillActionBusy] = useState(null) // 正在批准/拒绝的技能 id
  // 语义记忆（memory.list）
  const [memories, setMemories] = useState(null)
  const [memoriesLoading, setMemoriesLoading] = useState(false)

  const sid = context?.sessionId

  // 打开技能页时拉取后端工具目录（tools.list）
  useEffect(() => {
    if (!active) return
    let alive = true
    setToolsLoading(true)
    bridge
      .listTools()
      .then((res) => {
        if (!alive) return
        if (res?.ok) {
          const items = res.tools || []
          setTools(items)
          // 初始化启停占位：默认全开（仅本地预览，不落库）
          setToolToggles((prev) => {
            const next = { ...prev }
            for (const t of items) if (next[t.name] === undefined) next[t.name] = true
            return next
          })
        } else {
          setTools(null)
        }
      })
      .catch(() => {
        if (alive) setTools(null)
      })
      .finally(() => {
        if (alive) setToolsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [active])

  // 打开技能页时拉取工具集列表 + 当前会话激活的工具集（U1 bridge 合入后生效）
  useEffect(() => {
    if (!active) return
    let alive = true
    setToolsetsLoading(true)
    // TODO(U1): bridge.listToolsets / bridge.getActiveToolsets 合入前此处返回 null，界面显示接口未就绪
    const listP = bridge.listToolsets ? bridge.listToolsets() : Promise.resolve(null)
    const activeP =
      sid && bridge.getActiveToolsets ? bridge.getActiveToolsets(sid) : Promise.resolve(null)
    Promise.all([listP, activeP])
      .then(([lt, at]) => {
        if (!alive) return
        const norm = (list) =>
          (Array.isArray(list) ? list : [])
            .map((t) => (typeof t === 'string' ? t : t?.name || t?.id))
            .filter(Boolean)
        setToolsets(norm(lt?.ok ? lt.toolsets || lt.names : null))
        setActiveToolsets(norm(at?.ok ? at.toolsets || at.names : null))
      })
      .catch(() => {
        if (alive) {
          setToolsets([])
          setActiveToolsets([])
        }
      })
      .finally(() => {
        if (alive) setToolsetsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [active, sid])

  // 打开技能页时拉取后端技能列表（skills.list：pending / approved）
  useEffect(() => {
    if (!active) return
    let alive = true
    setSkillListLoading(true)
    // TODO(U1): bridge.listSkills 合入前返回 null，界面显示接口未就绪
    const p = bridge.listSkills ? bridge.listSkills() : Promise.resolve(null)
    p.then((res) => {
      if (alive) setSkillList(res?.ok ? res.skills || [] : null)
    })
      .catch(() => {
        if (alive) setSkillList(null)
      })
      .finally(() => {
        if (alive) setSkillListLoading(false)
      })
    return () => {
      alive = false
    }
  }, [active])

  // 打开技能页时拉取当前会话的语义记忆（memory.list）
  useEffect(() => {
    if (!active) return
    let alive = true
    setMemoriesLoading(true)
    // TODO(U1): bridge.listMemories 合入前返回 null，界面显示接口未就绪
    const p = sid && bridge.listMemories ? bridge.listMemories(sid) : Promise.resolve(null)
    p.then((res) => {
      if (alive) setMemories(res?.ok ? res.memories || [] : null)
    })
      .catch(() => {
        if (alive) setMemories(null)
      })
      .finally(() => {
        if (alive) setMemoriesLoading(false)
      })
    return () => {
      alive = false
    }
  }, [active, sid])

  // ---- U2 新增处理器：工具集 / 技能审批 ----

  // 切换工具集（多选 chip）：乐观更新，失败回滚
  async function handleToggleToolset(name) {
    if (!sid) {
      showMsg('当前没有可用会话，无法切换工具集')
      return
    }
    if (!bridge.setActiveToolsets) {
      showMsg('工具集接口未就绪（等待 bridge 合入）')
      return
    }
    const prev = activeToolsets
    const next = prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    setActiveToolsets(next)
    try {
      const res = await bridge.setActiveToolsets(sid, next)
      if (res?.ok) {
        showMsg(next.length ? `工具集已更新：${next.join(' / ')}` : '工具集已清空')
      } else {
        setActiveToolsets(prev)
        showMsg(`工具集保存失败：${res?.error || '未知错误'}`)
      }
    } catch (err) {
      setActiveToolsets(prev)
      showMsg(`工具集保存失败：${err.message}`)
    }
  }

  // 重新拉取技能列表（批准/拒绝后刷新）
  const refreshSkillList = useCallback(async () => {
    if (!bridge.listSkills) return
    const res = await bridge.listSkills().catch(() => null)
    setSkillList(res?.ok ? res.skills || [] : null)
  }, [])

  // 批准待审核技能（skills.approve）
  async function handleSkillApprove(id) {
    if (!bridge.approveSkill) {
      showMsg('技能批准接口未就绪（等待 bridge 合入）')
      return
    }
    setSkillActionBusy(id)
    try {
      const res = await bridge.approveSkill(id)
      showMsg(res?.ok ? '技能已批准，可进入执行列表' : `批准失败：${res?.error || '未知错误'}`)
      if (res?.ok) refreshSkillList()
    } catch (err) {
      showMsg(`批准失败：${err.message}`)
    } finally {
      setSkillActionBusy(null)
    }
  }

  // 拒绝待审核技能（skills.reject）
  async function handleSkillReject(id) {
    if (!bridge.rejectSkill) {
      showMsg('技能拒绝接口未就绪（等待 bridge 合入）')
      return
    }
    setSkillActionBusy(id)
    try {
      const res = await bridge.rejectSkill(id)
      showMsg(res?.ok ? '技能已拒绝' : `拒绝失败：${res?.error || '未知错误'}`)
      if (res?.ok) refreshSkillList()
    } catch (err) {
      showMsg(`拒绝失败：${err.message}`)
    } finally {
      setSkillActionBusy(null)
    }
  }

  // U2 派生：技能列表按状态分组（未标注 status 视为待批准）
  const pendingSkills = (skillList || []).filter((s) => s.status !== 'approved')
  const approvedSkills = (skillList || []).filter((s) => s.status === 'approved')

  if (!active) return null

  return (
    <section className="ep-pane">
      <div className="ep-card">
        <h3 className="ep-card-title">工具集切换</h3>
        {toolsetsLoading ? (
          <div className="ep-model-loading">读取中…</div>
        ) : toolsets.length ? (
          <div className="ep-toolsets">
            {toolsets.map((name) => (
              <button
                key={name}
                type="button"
                className={`ep-toolset-chip${activeToolsets.includes(name) ? ' active' : ''}`}
                onClick={() => handleToggleToolset(name)}
                disabled={!context?.sessionId}
              >
                {name}
              </button>
            ))}
          </div>
        ) : (
          <div className="ep-empty">工具集接口未就绪（等待 bridge 合入）</div>
        )}
        {!context?.sessionId ? (
          <div className="ep-note">当前没有可用会话，工具集切换已禁用。</div>
        ) : (
          <div className="ep-note">选择当前会话启用的工具集（core/dev/web/memory），保存到后端。</div>
        )}
      </div>

      <div className="ep-skills-grid">
        {skillCatalog.map((s) => {
          const on = skills[s.id] === true
          const disabled = skills[s.id] === undefined
          return (
            <div key={s.id} className={`ep-skill-card${disabled ? ' disabled' : ''}`}>
              <div className="ep-skill-head">
                <span className="ep-skill-icon">{s.icon}</span>
                <span className="ep-skill-name">{s.name}</span>
                <label className={`ep-toggle${disabled ? ' disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={disabled}
                    onChange={(e) => onToggleSkill(s.id, e.target.checked)}
                  />
                  <span className="ep-toggle-track" />
                  <span className="ep-toggle-thumb" />
                </label>
              </div>
              <div className="ep-skill-desc">{s.desc}</div>
              {s.id === 'approval' && (
                <div className="ep-skill-note">越界操作审批：开=自动放行，关=自动拒绝</div>
              )}
            </div>
          )
        })}
      </div>

      <div className="ep-card">
        <h3 className="ep-card-title">工具目录（后端）</h3>
        {toolsLoading ? (
          <div className="ep-model-loading">读取中…</div>
        ) : tools && tools.length ? (
          <div className="ep-tools-list">
            {tools.map((t) => (
              <div key={t.name} className="ep-tools-item">
                <label className="ep-toggle">
                  <input
                    type="checkbox"
                    checked={toolToggles[t.name] !== false}
                    onChange={(e) =>
                      setToolToggles((prev) => ({ ...prev, [t.name]: e.target.checked }))
                    }
                  />
                  <span className="ep-toggle-track" />
                  <span className="ep-toggle-thumb" />
                </label>
                <div className="ep-tools-body">
                  <div className="ep-tools-name-row">
                    <span className="ep-tools-name ep-mono">{t.name}</span>
                    <ToolSourceBadge tool={t} />
                  </div>
                  {t.description ? (
                    <span className="ep-tools-desc">{t.description}</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="ep-empty">后端未提供工具列表接口</div>
        )}
        <div className="ep-note">工具启停开关为占位展示，仅本地预览，不写入后端。</div>
      </div>

      <div className="ep-card">
        <h3 className="ep-card-title">待批准技能</h3>
        {skillListLoading ? (
          <div className="ep-model-loading">读取中…</div>
        ) : skillList ? (
          pendingSkills.length ? (
            <div className="ep-skill-pending">
              {pendingSkills.map((s) => (
                <div key={s.id || s.name} className="ep-skill-pending-item">
                  <div className="ep-skill-pending-body">
                    <span className="ep-skill-pending-name">{s.name || s.id}</span>
                    {s.description || s.desc ? (
                      <span className="ep-skill-pending-desc">{s.description || s.desc}</span>
                    ) : null}
                  </div>
                  <div className="ep-skill-pending-actions">
                    <button
                      type="button"
                      className="ep-approve-btn"
                      onClick={() => handleSkillApprove(s.id)}
                      disabled={skillActionBusy !== null}
                    >
                      {skillActionBusy === s.id ? '处理中…' : '批准'}
                    </button>
                    <button
                      type="button"
                      className="ep-reject-btn"
                      onClick={() => handleSkillReject(s.id)}
                      disabled={skillActionBusy !== null}
                    >
                      拒绝
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ep-empty">暂无待批准技能</div>
          )
        ) : (
          <div className="ep-empty">技能列表接口未就绪（等待 bridge 合入）</div>
        )}
      </div>

      <div className="ep-card">
        <h3 className="ep-card-title">已批准技能</h3>
        {skillListLoading ? (
          <div className="ep-model-loading">读取中…</div>
        ) : skillList ? (
          approvedSkills.length ? (
            <div className="ep-skill-pending">
              {approvedSkills.map((s) => (
                <div key={s.id || s.name} className="ep-skill-pending-item ep-skill-approved">
                  <div className="ep-skill-pending-body">
                    <span className="ep-skill-pending-name">{s.name || s.id}</span>
                    {s.description || s.desc ? (
                      <span className="ep-skill-pending-desc">{s.description || s.desc}</span>
                    ) : null}
                  </div>
                  <span className="ep-badge on">已批准</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="ep-empty">暂无已批准技能</div>
          )
        ) : (
          <div className="ep-empty">技能列表接口未就绪（等待 bridge 合入）</div>
        )}
      </div>

      <div className="ep-card">
        <h3 className="ep-card-title">言叶记得的事</h3>
        {memoriesLoading ? (
          <div className="ep-model-loading">读取中…</div>
        ) : memories ? (
          memories.length ? (
            <div className="ep-memories">
              {memories.map((m, i) => (
                <div key={m.id || i} className="ep-memory-item">
                  <span className="ep-memory-entity">{m.entity || '—'}</span>
                  {m.relation ? <span className="ep-memory-relation">{m.relation}</span> : null}
                  {m.detail ? <span className="ep-memory-detail">{m.detail}</span> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="ep-empty">还没有记忆，多聊聊就会有的～</div>
          )
        ) : (
          <div className="ep-empty">记忆接口未就绪（等待 bridge 合入）</div>
        )}
      </div>
    </section>
  )
}
