// ============================================================
// mentions.ts —— @mention 解析与文件内容注入
// 支持 @file.ts 单文件、@dir/ 整目录递归
// 中文注释、英文标识符
// ============================================================

import fs from 'node:fs'
import path from 'node:path'
import type { Tool, ToolContext, ToolResult } from '../types'

export interface FileRef {
  path: string
  content: string
  truncated: boolean
  size: number
}

export interface MentionResult {
  text: string
  files: FileRef[]
  systemFragments: string[]
}

/**
 * 解析文本中的 @mention 模式
 * @file.ts - 单文件
 * @dir/ - 整目录（递归读取 .ts/.tsx/.js/.json/.md 等）
 */
function extractMentions(text: string): string[] {
  const mentions: string[] = []
  // 匹配 @ 开头，后跟非空白字符，直到空白或行尾
  const regex = /@([^\s@]+)/g
  let match
  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1])
  }
  return mentions
}

/**
 * 判断是否为目录引用（以 / 结尾）
 */
function isDirMention(mention: string): boolean {
  return mention.endsWith('/') || mention.endsWith('\\')
}

/**
 * 规范化路径，移除 @ 前缀
 */
function normalizeMentionPath(mention: string): string {
  return mention.replace(/^[@\\/]+/, '').replace(/[\\/]+$/, '')
}

/**
 * 获取目录下的代码文件（递归）
 */
async function getCodeFilesInDir(
  dirPath: string,
  cwd: string,
  globTool: Tool,
  ctx: ToolContext
): Promise<string[]> {
  const result = await globTool.run(ctx, {
    pattern: `${dirPath}/**/*.{ts,tsx,js,jsx,json,md,mdx}`,
    nodir: true,
  })
  if (!result.ok) return []
  try {
    return JSON.parse(result.output) as string[]
  } catch {
    return []
  }
}

/**
 * 读取单个文件内容
 */
async function readFileContent(
  filePath: string,
  cwd: string,
  readFileTool: Tool,
  ctx: ToolContext
): Promise<{ content: string; truncated: boolean; size: number }> {
  const result = await readFileTool.run(ctx, { path: filePath })
  if (!result.ok) {
    return { content: '', truncated: false, size: 0 }
  }
  const truncated = result.output.includes('(已截断')
  return {
    content: result.output,
    truncated,
    size: Buffer.byteLength(result.output, 'utf8'),
  }
}

/**
 * 解析 @mention 并读取文件内容
 * 
 * @param text 用户输入文本
 * @param cwd 工作目录
 * @param tools 可用工具映射（需包含 read_file 和 glob）
 * @param ctx ToolContext（用于沙箱校验）
 * @returns 处理后的文本（移除 @mention）、文件引用列表、system 片段
 */
export async function resolveMentions(
  text: string,
  cwd: string,
  tools: Map<string, Tool>,
  ctx: ToolContext
): Promise<MentionResult> {
  const mentions = extractMentions(text)
  if (mentions.length === 0) {
    return { text, files: [], systemFragments: [] }
  }

  const readFileTool = tools.get('read_file')
  const globTool = tools.get('glob')

  if (!readFileTool || !globTool) {
    return { text, files: [], systemFragments: [] }
  }

  const files: FileRef[] = []
  const systemFragments: string[] = []
  let processedText = text

  // 处理每个 mention
  for (const mention of mentions) {
    const cleanPath = normalizeMentionPath(mention)
    const resolvedPath = path.resolve(cwd, cleanPath)
    const isDir = isDirMention(mention)

    // 安全检查：必须在 cwd 内
    if (resolvedPath !== cwd && !resolvedPath.startsWith(cwd + path.sep)) {
      systemFragments.push(`[警告] @${mention} 路径超出工作区，已忽略`)
      continue
    }

    if (isDir) {
      // 目录引用：递归读取代码文件
      const relDir = path.relative(cwd, resolvedPath)
      const codeFiles = await getCodeFilesInDir(relDir, cwd, globTool, ctx)
      
      let totalSize = 0
      const MAX_DIR_SIZE = 100 * 1024 // 100KB 限制
      
      for (const file of codeFiles) {
        if (totalSize > MAX_DIR_SIZE) {
          systemFragments.push(`[提示] @${mention} 目录文件总大小超限，已截断`)
          break
        }
        const { content, truncated, size } = await readFileContent(file, cwd, readFileTool, ctx)
        if (content) {
          files.push({ path: file, content, truncated, size })
          systemFragments.push(`--- @${mention}${file} ---\n${content}`)
          totalSize += size
        }
      }
    } else {
      // 单文件引用
      const relPath = path.relative(cwd, resolvedPath)
      const { content, truncated, size } = await readFileContent(relPath, cwd, readFileTool, ctx)
      if (content) {
        files.push({ path: relPath, content, truncated, size })
        systemFragments.push(`--- @${relPath} ---\n${content}`)
      } else {
        systemFragments.push(`[警告] @${relPath} 文件不存在或为空`)
      }
    }

    // 从用户文本中移除 @mention（避免重复发送给模型）
    processedText = processedText.replace(new RegExp(`@${mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), '').trim()
  }

  return {
    text: processedText,
    files,
    systemFragments,
  }
}

/**
 * 将文件引用转换为 system 消息片段
 * 用于注入到 messages 数组中
 */
export function fileRefsToSystemFragments(files: FileRef[]): string[] {
  return files.map(f => `--- 文件引用: ${f.path} (${f.size} bytes) ---\n${f.content}`)
}