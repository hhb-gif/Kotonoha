import { useState } from 'react'

// 玩家回合输入框：复用对话框位置，一屏一方。
// 玩家发言时，对话框区域变成输入框（视觉小说式「台词输入」）。
// props:
//   onSend(text)
export default function PlayerInput({ onSend }) {
  const [value, setValue] = useState('')

  function submit() {
    const text = value.trim()
    if (!text) return
    onSend(text)
    setValue('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="dialog-box player-input">
      <div className="dialog-name">你</div>
      <div className="player-input-row">
        <input
          type="text"
          className="player-input-field"
          placeholder="输入你的话语……"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button type="button" className="btn player-input-send" onClick={submit}>
          发送
        </button>
      </div>
      <div className="player-input-hint">言叶在等待你的话语……</div>
    </div>
  )
}