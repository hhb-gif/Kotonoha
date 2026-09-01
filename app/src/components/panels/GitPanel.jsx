// panels/GitPanel.jsx —— Git 页签：工作区路径 + 状态/提交/日志（交给言叶在会话内执行）
// 自包含：git 状态查询与「请言叶执行」操作的加载态与输出展示
import { useState } from 'react'
import bridge from '../../bridge/bridge'
import { resolveStory } from './shared'

export default function GitPanel({ active, context, showMsg }) {
  const [gitLoading, setGitLoading] = useState(false)
  const [gitBusy, setGitBusy] = useState(false)
  const [gitOutput, setGitOutput] = useState('')
  const [gitError, setGitError] = useState('')

  // context 里没有 path 时按故事名反查 stories 索引拿工作区路径
  const workspacePath = context?.path || resolveStory(context?.storyName)?.path || '-'

  async function handleGitStatus() {
    setGitLoading(true)
    setGitOutput('')
    setGitError('')
    try {
      const res = await bridge.getGitStatus()
      if (res?.ok) {
        setGitOutput(res.output || '（无改动）')
      } else {
        setGitError(res?.error || '无法获取 Git 状态')
      }
    } catch (err) {
      setGitError(err.message)
    } finally {
      setGitLoading(false)
    }
  }

  async function handleGitCommit() {
    setGitBusy(true)
    try {
      await bridge.sendCommandToAgent(
        '请执行 git add -A 并提交，提交信息简洁描述当前改动，先 git status 和 git diff 看看改了什么'
      )
      showMsg('已交给言叶执行提交，结果将显示在对话中')
    } catch (err) {
      showMsg(`发送失败：${err.message}`)
    } finally {
      setGitBusy(false)
    }
  }

  async function handleGitLog() {
    setGitBusy(true)
    try {
      await bridge.sendCommandToAgent('请执行 git log --oneline -10 并简要汇报')
      showMsg('已交给言叶，最近提交将显示在对话中')
    } catch (err) {
      showMsg(`发送失败：${err.message}`)
    } finally {
      setGitBusy(false)
    }
  }

  if (!active) return null

  return (
    <section className="ep-pane">
      <div className="ep-card">
        <h3 className="ep-card-title">Git 控制</h3>
        <div className="ep-row">
          <span className="ep-label">工作区</span>
          <span className="ep-value ep-path">{workspacePath}</span>
        </div>
        <div className="ep-act-row">
          <button
            type="button"
            className="ep-btn ep-act-btn"
            onClick={handleGitStatus}
            disabled={gitLoading || gitBusy}
          >
            {gitLoading ? '读取中…' : 'Git 状态'}
          </button>
          <button
            type="button"
            className="ep-btn ep-act-btn"
            onClick={handleGitCommit}
            disabled={gitBusy || gitLoading}
          >
            {gitBusy ? '处理中…' : '提交当前改动'}
          </button>
          <button
            type="button"
            className="ep-btn ep-act-btn"
            onClick={handleGitLog}
            disabled={gitBusy || gitLoading}
          >
            查看最近提交
          </button>
        </div>
        <div className="ep-note">
          「提交当前改动」与「查看最近提交」会交给言叶在会话中执行，结果显示在对话里。
        </div>
      </div>

      {(gitOutput || gitError) && (
        <div className="ep-card">
          <h3 className="ep-card-title">Git 状态输出</h3>
          {gitError ? (
            <pre className="ep-output ep-output-err">{gitError}</pre>
          ) : (
            <pre className="ep-output">{gitOutput}</pre>
          )}
        </div>
      )}
    </section>
  )
}
