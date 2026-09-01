// ============================================================
// i18n/index.js —— 轻量 i18n 框架（key = 中文原文）
//
// 设计：
//   - 语言包：zh.js（中文兜底）/ en.js / ja.js，key 直接用界面上的中文文案
//   - extras 合并：D1 并行 agent 的追加 key 放 ./extras.js（文件可能尚不存在）。
//     浏览器 ESM 环境没有 require，改用 Vite 的 import.meta.glob 实现等价容错：
//     文件缺失时返回空映射，静默不报错；extras.js 出现后无需改这里即自动合并。
//     eager 模式同步加载，t() 立即可用。
//   - 语言存 settings（kotonoha:settings.language，默认 'zh'）
//   - t(key) 三级回落：当前语言包 → zh 包 → key 原文
//   - 切语言 = setSettings({ language }) + window.location.reload()
//     （reload 后所有模块重新求值，模块级 t() 调用因此安全）
// ============================================================
import { getSettings, setSettings } from '../bridge/settings'
import zh from './zh.js'
import en from './en.js'
import ja from './ja.js'

// ---- extras 合并（D1-timeline 的追加 key 包；文件可能不存在，静默容错）----
const extrasModules = import.meta.glob('./extras.js', {
  eager: true,
  import: 'default',
})
for (const mod of Object.values(extrasModules)) {
  if (!mod || typeof mod !== 'object') continue
  if (mod.zh && typeof mod.zh === 'object') {
    // 按语言分包结构：{ zh: {...}, en: {...}, ja: {...} }
    Object.assign(zh, mod.zh)
    Object.assign(en, mod.en || {})
    Object.assign(ja, mod.ja || {})
  } else {
    // 平面结构（与 zh.js 同构）：整体并入 zh 兜底（en/ja 缺 key 时自然回落中文）
    Object.assign(zh, mod)
  }
}

const packs = { zh, en, ja }

// 当前语言（模块加载时读一次；reload 切语言方案下模块级求值安全）
let currentLang = getSettings().language || 'zh'

/** 翻译：当前语言包 → zh 兜底 → key 原文（三级回落，永不返回 undefined） */
export function t(key) {
  const pack = packs[currentLang]
  return (pack && pack[key]) ?? zh[key] ?? key
}

/** 切换语言：写入 settings 后整页 reload（简单可靠，视觉小说场景可接受） */
export function setLanguage(lang) {
  if (!packs[lang]) lang = 'zh'
  setSettings({ language: lang })
  window.location.reload()
}

/** 当前语言（'zh' | 'en' | 'ja'） */
export function getLanguage() {
  return currentLang
}
