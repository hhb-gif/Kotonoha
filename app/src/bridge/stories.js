// ============================================================
// stories.js —— 故事 / 存档 数据层（本地存储）
//
// 「故事」= 工作区（映射到 dsh 会话的 cwd），每个故事有独立的存档体系；
// 「存档」= 一次会话记录（sessionId + 元信息）。
// 所有持久化都在 localStorage，键：
//   kotonoha:stories         全局故事索引
//   kotonoha:saves:<storyId> 某故事下的存档列表
//   kotonoha:context         当前上下文 { storyId, saveId }
// ============================================================

const STORIES_KEY = 'kotonoha:stories'
const CONTEXT_KEY = 'kotonoha:context'
const LEGACY_SAVE_KEY = 'kotonoha:save' // 旧版单存档位（迁移用）
const LEGACY_STORY_NAME = 'Kotonoha'
const LEGACY_STORY_PATH = 'E:\\Kotonoha'

// ---- 读写工具 ----
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    console.error('[stories] write failed:', key, err)
  }
}

function uid() {
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

// ---- 故事 ----
export function listStories() {
  const data = readJSON(STORIES_KEY, { stories: [] })
  return (data.stories || []).slice().sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))
}

export function getStory(id) {
  return listStories().find((s) => s.id === id) || null
}

export function createStory({ name, path }) {
  const cleanName = String(name || '').trim()
  const cleanPath = String(path || '').trim()
  if (!cleanName) throw new Error('故事名称不能为空')
  if (!cleanPath) throw new Error('工作区路径不能为空')
  const story = {
    id: uid(),
    name: cleanName,
    path: cleanPath,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  }
  const data = readJSON(STORIES_KEY, { stories: [] })
  const stories = data.stories || []
  // 同名故事视为同一故事（更新路径与时间戳），避免重复堆叠
  const existing = stories.find((s) => s.name === cleanName)
  if (existing) {
    existing.path = cleanPath
    existing.lastActiveAt = Date.now()
    writeJSON(STORIES_KEY, { stories })
    return existing
  }
  stories.push(story)
  writeJSON(STORIES_KEY, { stories })
  return story
}

export function updateStory(id, patch) {
  const data = readJSON(STORIES_KEY, { stories: [] })
  const stories = data.stories || []
  const story = stories.find((s) => s.id === id)
  if (!story) return null
  if (patch.name !== undefined) story.name = String(patch.name).trim()
  if (patch.path !== undefined) story.path = String(patch.path).trim()
  if (patch.lastActiveAt !== undefined) story.lastActiveAt = patch.lastActiveAt
  writeJSON(STORIES_KEY, { stories })
  return story
}

export function deleteStory(id) {
  const data = readJSON(STORIES_KEY, { stories: [] })
  const stories = (data.stories || []).filter((s) => s.id !== id)
  writeJSON(STORIES_KEY, { stories })
  localStorage.removeItem(savesKey(id))
  const ctx = getContext()
  if (ctx && ctx.storyId === id) clearContext()
}

// ---- 存档 ----
function savesKey(storyId) {
  return `kotonoha:saves:${storyId}`
}

export function listSaves(storyId) {
  const data = readJSON(savesKey(storyId), { saves: [] })
  return (data.saves || []).slice().sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))
}

export function getSave(storyId, saveId) {
  return listSaves(storyId).find((s) => s.id === saveId) || null
}

/**
 * 新建存档。同名存档视为同一存档（复用 id），实现「保存 = 覆盖」。
 * @returns {{ story, save }}
 */
export function createSave(storyId, { name, sessionId }) {
  const cleanName = String(name || '').trim()
  if (!cleanName) throw new Error('存档名称不能为空')
  if (!sessionId) throw new Error('会话尚未就绪')
  const now = Date.now()
  const data = readJSON(savesKey(storyId), { saves: [] })
  const saves = data.saves || []
  const existing = saves.find((s) => s.name === cleanName)
  if (existing) {
    existing.sessionId = sessionId
    existing.lastActiveAt = now
    writeJSON(savesKey(storyId), { saves })
    updateStory(storyId, { lastActiveAt: now })
    return { story: getStory(storyId), save: existing }
  }
  const save = {
    id: uid(),
    name: cleanName,
    sessionId,
    createdAt: now,
    lastActiveAt: now,
    preview: '',
  }
  saves.push(save)
  writeJSON(savesKey(storyId), { saves })
  updateStory(storyId, { lastActiveAt: now })
  return { story: getStory(storyId), save }
}

export function updateSave(storyId, saveId, patch) {
  const data = readJSON(savesKey(storyId), { saves: [] })
  const saves = data.saves || []
  const save = saves.find((s) => s.id === saveId)
  if (!save) return null
  if (patch.name !== undefined) save.name = String(patch.name).trim()
  if (patch.preview !== undefined) save.preview = String(patch.preview).slice(0, 80)
  if (patch.lastActiveAt !== undefined) save.lastActiveAt = patch.lastActiveAt
  writeJSON(savesKey(storyId), { saves })
  return save
}

export function deleteSave(storyId, saveId) {
  const data = readJSON(savesKey(storyId), { saves: [] })
  const saves = (data.saves || []).filter((s) => s.id !== saveId)
  writeJSON(savesKey(storyId), { saves })
  const ctx = getContext()
  if (ctx && ctx.storyId === storyId && ctx.saveId === saveId) clearContext()
}

// ---- 上下文 ----
export function getContext() {
  const ctx = readJSON(CONTEXT_KEY, null)
  if (!ctx) return null
  // 上下文可能失效（故事/存档被删），这里只返回原始值，由上层校验
  return { storyId: ctx.storyId || null, saveId: ctx.saveId || null }
}

export function setContext(storyId, saveId) {
  writeJSON(CONTEXT_KEY, { storyId, saveId })
}

export function clearContext() {
  localStorage.removeItem(CONTEXT_KEY)
}

/** 最近活动的故事（「继续」入口用） */
export function lastStory() {
  return listStories()[0] || null
}

/** 最近活动存档（上下文缺失时的兜底） */
export function lastSave(storyId) {
  return listSaves(storyId)[0] || null
}

// ---- 迁移 ----
/** 旧版单存档位（kotonoha:save）→ 迁移为默认故事下的存档。幂等。 */
export function migrateLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_SAVE_KEY)
    if (!raw) return
    const slot = JSON.parse(raw)
    if (!slot?.sessionId) return
    const story = createStory({ name: LEGACY_STORY_NAME, path: LEGACY_STORY_PATH })
    createSave(story.id, { name: '对话', sessionId: slot.sessionId })
    localStorage.removeItem(LEGACY_SAVE_KEY)
    console.log('[stories] migrated legacy save →', story.name, slot.sessionId)
  } catch (err) {
    console.warn('[stories] migrateLegacy failed:', err)
  }
}

export default {
  listStories,
  getStory,
  createStory,
  updateStory,
  deleteStory,
  listSaves,
  getSave,
  createSave,
  updateSave,
  deleteSave,
  getContext,
  setContext,
  clearContext,
  lastStory,
  lastSave,
  migrateLegacy,
}