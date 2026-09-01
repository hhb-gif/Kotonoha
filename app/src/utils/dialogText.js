// utils/dialogText.js —— 对话文本处理：markdown 轻清理 + 分页切分
// 原 App.jsx 内联工具迁移，供对话框分页打字使用。

// 轻量清理 markdown 符号：保留文字、去掉 `**` ` 反引号 # 标题符号等，避免「大小粗细不一」的乱码观感
export function cleanMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^>\s?/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
}

// 把长文本切成「页」：每页最多 maxLines 行；单行超过 maxChars 按标点切段
// maxLines=4：用户反馈断句太碎，每次显示的话语要多一点
export function splitIntoPages(text, maxLines = 4, maxChars = 100) {
  text = cleanMarkdown(text)
  if (!text) return []
  const pages = []
  let cur = ''
  let lines = 0
  const pushLine = (line) => {
    if (!line) return
    if (cur && lines >= maxLines) {
      pages.push(cur)
      cur = ''
      lines = 0
    }
    cur = cur ? cur + '\n' + line : line
    lines++
  }
  for (const line of text.split('\n')) {
    let rest = line.trim()
    while (rest.length > maxChars) {
      let cut = -1
      for (let i = Math.min(maxChars, rest.length); i > 0; i--) {
        if ('。！？；，、.!?;,'.includes(rest[i - 1])) {
          cut = i
          break
        }
      }
      if (cut < 0) cut = maxChars
      pushLine(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    if (rest) pushLine(rest)
  }
  if (cur) pages.push(cur)
  return pages.length ? pages : [text]
}
