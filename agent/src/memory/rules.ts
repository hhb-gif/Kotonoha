// ============================================================
// rules.ts —— 规则加载/合并：三层 KOTONOHA.md (项目 > 用户 > 会话)
// 中文注释、英文标识符
// ============================================================

import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

export interface RuleLayer {
  source: 'project' | 'user' | 'session'
  path: string
  content: string
  updatedAt: number
}

export interface RuleSet {
  project?: RuleLayer
  user?: RuleLayer
  session?: RuleLayer
  merged: string
}

/**
 * 解析 KOTONOHA.md，提取三个层级的规则内容
 * 格式：
 * ## 项目规则
 * - ...
 * ## 用户规则
 * - ...
 * ## 会话规则
 * - ...
 */
function parseRules(content: string): { project: string; user: string; session: string } {
  const result = { project: '', user: '', session: '' }
  let currentSection: keyof typeof result | null = null

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '## 项目规则' || trimmed === '## Project Rules') {
      currentSection = 'project'
      continue
    }
    if (trimmed === '## 用户规则' || trimmed === '## User Rules') {
      currentSection = 'user'
      continue
    }
    if (trimmed === '## 会话规则' || trimmed === '## Session Rules') {
      currentSection = 'session'
      continue
    }
    if (currentSection && trimmed.startsWith('## ')) {
      currentSection = null
      continue
    }
    if (currentSection && trimmed.length > 0) {
      result[currentSection] += line + '\n'
    }
  }

  return {
    project: result.project.trim(),
    user: result.user.trim(),
    session: result.session.trim(),
  }
}

/**
 * 合并三层规则：会话 > 用户 > 项目（后者覆盖前者）
 * 实际逻辑是：项目作为基础，用户覆盖/补充，会话再覆盖/补充
 * 返回合并后的完整 markdown 内容
 */
function mergeRules(project: string, user: string, session: string): string {
  const parts: string[] = ['# KOTONOHA 规则', '']

  if (project) {
    parts.push('## 项目规则')
    parts.push(project)
    parts.push('')
  }
  if (user) {
    parts.push('## 用户规则')
    parts.push(user)
    parts.push('')
  }
  if (session) {
    parts.push('## 会话规则')
    parts.push(session)
    parts.push('')
  }

  return parts.join('\n').trim() + '\n'
}

function readRuleFile(filePath: string): RuleLayer | null {
  try {
    const stat = fs.statSync(filePath)
    const content = fs.readFileSync(filePath, 'utf8')
    const source = filePath.includes('.kotonoha') ? 'user' : 
                   filePath.includes('session') ? 'session' : 'project'
    return {
      source,
      path: filePath,
      content,
      updatedAt: stat.mtimeMs,
    }
  } catch {
    return null
  }
}

function getDefaultPaths(projectRoot: string): { project: string; user: string; session: string } {
  return {
    project: path.join(projectRoot, 'KOTONOHA.md'),
    user: path.join(homedir(), '.kotonoha', 'rules.md'),
    session: path.join(projectRoot, '.kotonoha', 'session-rules.md'),
  }
}

/**
 * 加载三层规则文件并合并
 * 优先级：项目 < 用户 < 会话（后者覆盖前者的同名规则，但保留各自独立段落）
 */
export async function loadRules(projectRoot: string): Promise<RuleSet> {
  const paths = getDefaultPaths(projectRoot)

  const projectLayer = readRuleFile(paths.project)
  const userLayer = readRuleFile(paths.user)
  const sessionLayer = readRuleFile(paths.session)

  // 解析各层内容
  const projectContent = projectLayer ? parseRules(projectLayer.content).project : ''
  const userContent = userLayer ? parseRules(userLayer.content).user : ''
  const sessionContent = sessionLayer ? parseRules(sessionLayer.content).session : ''

  const merged = mergeRules(projectContent, userContent, sessionContent)

  return {
    project: projectLayer || undefined,
    user: userLayer || undefined,
    session: sessionLayer || undefined,
    merged,
  }
}

/**
 * 保存规则集（主要用于会话规则的持久化）
 */
export async function saveRules(rules: RuleSet, projectRoot: string): Promise<void> {
  const paths = getDefaultPaths(projectRoot)

  // 确保目录存在
  for (const p of [paths.user, paths.session]) {
    const dir = path.dirname(p)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  // 只持久化会话规则（项目/用户规则由外部管理）
  if (rules.session) {
    // 读取现有会话文件，保留其他层级，只更新会话层
    let existingContent = ''
    try {
      existingContent = fs.readFileSync(paths.session, 'utf8')
    } catch {
      // 文件不存在，创建新的
    }

    const parsed = existingContent ? parseRules(existingContent) : { project: '', user: '', session: '' }
    parsed.session = rules.session.content.replace(/^## 会话规则\s*\n/, '').trim()

    const newContent = mergeRules(parsed.project, parsed.user, parsed.session)
    fs.writeFileSync(paths.session, newContent, 'utf8')
  }
}

/**
 * 追加一条会话规则（用于羁绊记忆沉淀）
 */
export async function appendSessionRule(projectRoot: string, rule: string): Promise<void> {
  const paths = getDefaultPaths(projectRoot)
  const sessionPath = paths.session

  // 确保目录存在
  const dir = path.dirname(sessionPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  let existingContent = ''
  try {
    existingContent = fs.readFileSync(sessionPath, 'utf8')
  } catch {
    // 文件不存在
  }

  const parsed = existingContent ? parseRules(existingContent) : { project: '', user: '', session: '' }
  
  // 添加新规则，带日期前缀
  const datePrefix = new Date().toISOString().split('T')[0]
  const newRule = `${datePrefix}: ${rule}`
  
  if (parsed.session) {
    parsed.session += '\n' + newRule
  } else {
    parsed.session = newRule
  }

  const newContent = mergeRules(parsed.project, parsed.user, parsed.session)
  fs.writeFileSync(sessionPath, newContent, 'utf8')
}

/**
 * 获取会话规则文件路径
 */
export function getSessionRulesPath(projectRoot: string): string {
  return getDefaultPaths(projectRoot).session
}