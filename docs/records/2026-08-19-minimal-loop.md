# Kotonoha 最小闭环 — 工作记录

> 日期：2026-08-19
> 状态：✅ 最小闭环完成，端到端验证通过

## 本轮做了什么

1. **协议验证（子任务 A）** → `docs/verification-report.md`
   - 结论：dsh 可被外部进程完全驱动（Typert RPC：`POST /api/<method>` + `ws://api/events.mux`）
   - 真实工具执行已验证（agent 通过外部驱动创建文件成功）
   - 风险与对策：opencode 免费模型 429 限流 → 降级 `deepseek-official/deepseek-v4-flash`（新会话实测默认已是该模型）

2. **前端壳（子任务 B）** → `app/`
   - React + Vite，视觉小说风：全屏背景、角色立绘、底部对话框、打字机、输入栏、存档/读档/新游戏
   - `src/bridge/bridge.js` 为桥接层，事件协议与 UI 解耦

3. **素材（子任务 C）** → `assets/` → 复制进 `app/public/assets/`
   - `bg-room.png` 书房夜景背景（16:9）
   - `bg-night.png` 夜空天台背景（16:9，备用）
   - `character.png` AI 助手立绘（3:4）

4. **接线（本会话）**
   - `vite.config.js`：`/api` 代理到 `127.0.0.1:3080`（ws: true），规避 dsh Origin 校验
   - `bridge.js` 重写：真实对接 dsh（建会话/发消息/收流式事件/历史重放/429 降级重试/断线重连）
   - `App.jsx`：接入 init/replay/error 事件、技能执行旁白、新游戏按钮
   - 存档 = 记录 sessionId 到 localStorage 存档位；读档 = 切回会话 + 历史重放；新游戏 = 新建会话

## 端到端验证结果（`temp/e2e-check.mjs`）

经 Vite proxy（5173）模拟浏览器路径：
- ✅ HTTP RPC 通（session.list / create / prompt）
- ✅ WebSocket 事件流通（events.mux 代理转发）
- ✅ 真实对话完成（agent 回复）
- ✅ 真实工具执行（agent 创建 `temp/e2e-check.txt`，内容正确）

## 运行方式

```
dsh web                    # 3080 已有实例在跑则跳过
cd E:\Kotonoha\app
npm run dev                # → http://127.0.0.1:5173
```

浏览器打开 5173 即可：与言叶对话、让它写代码，存档/读档/新游戏可用。

## 遗留 / 下一步建议

- [ ] 工具调用事件在 UI 的完整呈现（目前是「技能」旁白 + 可扩展）
- [ ] 场景切换（bg-room ↔ bg-night 已备好素材）
- [ ] 多角色 = 多模型（bridge 的 CHARACTERS 已预留）
- [ ] 设置面板（文本速度/音量/跳过）
- [ ] approval 审批交互（`POST /api/respond`，高权限操作时触发）

---

## 第二轮：交互重构与设置面板（2026-08-19）

### 用户反馈的 5 个问题及处理

| # | 问题 | 处理 |
|---|---|---|
| 1 | 立绘黑底方块 | ✅ `scripts/remove-black-bg.py` 抠黑底（距离阈值 + 连通域保护 + 边缘羽化），透明占比 50.8%，输出透明 PNG 覆盖 `app/public/assets/character.png` |
| 2 | 设置没有可选内容 | ✅ 新建 `src/components/SettingsPanel.jsx` + `src/bridge/settings.js`：文本速度滑块 / 背景切换（书房↔天台）/ 立绘开关 / 模型与密钥管理 |
| 3 | 前端没有 API 输入 | ✅ 架构说明：密钥在 dsh 侧（`~/.dsh/.credentials.yaml`），前端不持密钥；设置面板已支持可视化写入（`credentials.set`，payload `{ref, value}`，ref 如 `DEEPSEEK_API_KEY`） |
| 4 | 界面格式：一屏双方 | ✅ 重构为推进式「一屏一方」：对话框只显示当前说话者一条消息，点/回车推进；玩家回合时对话框内变为输入框（PlayerInput），输入后先显示玩家台词再自动切到模型流式 |
| 5 | 是否真实后端 | ✅ 是。e2e 验证（经 Vite proxy 5173 全链路）：真实对话 + `write` 工具真实建文件 |

### 交互状态机（重构后）

```
历史消息逐条展示（打字机）→ 点击推进 → 尾部且轮到玩家 → 对话框变输入框
玩家发送 → 显示玩家台词（打字）→ 模型 turn/start → 追加占位消息 → 流式文本
→ model:done 补全占位 → 打字完成后自动推进 → 玩家回合
```

- 占位消息：`{role:'model', text:''}`，`Typewriter` 靠「完整文本 startsWith 已显示部分」无缝续打
- 错误时撤销尾部空占位，回到可输入状态
- 新增文件：`PlayerInput.jsx`、`SettingsPanel.jsx`、`bridge/settings.js`、`scripts/remove-black-bg.py`

### 素材

- 原图存档 `assets/character-ai-raw.png`；`bg-night.png` 已接入背景切换

### 下一步建议

- [ ] 工具调用完整演出（技能卡片 + 可展开 diff/参数）
- [ ] approval 审批交互（`POST /api/respond`）
- [ ] 多角色 = 多模型
- [ ] BGM / 音效

---

## 第三轮：浏览器端排查（2026-08-19）

### 病状

通过 opencli 浏览器桥接测试时，发送消息后 UI「无反应 / 卡死」，且 dsh 侧确认消息已收到并完成 turn（`session.history` turns:1 完整）。

### 根因（3 个工具陷阱 + 1 个真实代码 bug）

| # | 现象 | 根因 | 对策 |
|---|---|---|---|
| 1 | 改完代码页面行为诡异（发送无反应、状态错乱） | `opencli browser open` **不触发 reload**（`performance.timeOrigin` 不变、`window` 变量跨 open 保留）→ 页面一直跑旧模块，bridge.js 每次 HMR 热更都重置内部状态（listeners/state/initStarted），而 App 的 useEffect 订阅不重跑 → 事件无人听 | 用 `eval location.reload()` 强制刷新后再测；调试时不要中途改代码 |
| 2 | `fill` 输入后发送无反应 | opencli `fill` 直接设 DOM value，**不触发 React onChange** → 受控组件 state 未同步 → `submit()` 拿到空文本直接 return | 用 `type` 命令（CDP 真实键盘事件），或 eval 里 `native setter + dispatchEvent(new Event('input', {bubbles:true})) + Enter keydown` |
| 3 | `state` 显示中间区域空白，误判「页面卡死」 | opencli a11y 树抓取不稳定，**漏报可见元素**（`.player-input-field` 明明 855×51 可见） | 用 eval `getBoundingClientRect()` 验证真实可见性 |
| 4 | 刷新/读档后历史里模型回复全空、混入系统消息 | `historyToMessages` 真实 bug：assistant 文本在 `data.message.content`（代码写成了 `data.content`）；系统注入消息（runtime context / system-reminder，无 `source` 字段）被当玩家消息；reasoning/tool-call 中间步骤未跳过 | 修复：按 `data.message?.content` 提取 text；`user/message` 无 `source.kind==='user'` 则跳过；空文本消息跳过 |

### 验证（全链路，经 opencli 真实浏览器）

- ✅ 页面加载 → init → 恢复存档会话 → 历史 6 条真实对话完整重放（含模型回复全文）
- ✅ 玩家回合（输入框 855×51 可见 + 「言叶在等待你的话语……」）
- ✅ eval 模拟键盘输入发送「帮我在temp里创建hello.txt，内容写hi」→ 玩家台词显示 → 模型流式 → turn/end → 回到玩家回合
- ✅ dsh 侧 `write` 工具真实执行：`temp/hello.txt` 内容 = `hi`

### 调试工具沉淀（temp/）

- `eval-reload.ps1`（强制刷新）、`eval-app-state.ps1`（App 实时状态）、`eval-full-state.ps1`（bridge+DOM 检查）、`eval-input-visible.ps1`、`eval-send-via-events.ps1`（React 兼容输入发送）
- App.jsx 暴露 `window.__appDebug`、bridge.js 暴露 `window.__bridgeDebug`（开发调试用，保留）

### 遗留

- [ ] savedAt 刷新后不恢复（header 显示「无存档」但存档位实际存在）——读档按钮可正常恢复，属显示层小问题

---

## 第四轮：修复「发送后模型没有回复」（2026-08-19）

### 病状

用户手动发送消息后，模型没有回复（dsh 侧确认 turn 已完整完成：turns:1、167 tokens 解码、running=false）。

### 根因 1：WS 事件流全局广播，未按 sessionId 过滤

- `ws://127.0.0.1:3080/api/events.mux`（经 proxy）是**全局事件流**：所有 session 的 `session/subscribed` 确认 + `session/event` 事件推给所有客户端
- `session/event` payload 带 `sessionId` 字段（`{type:'session/event', sessionId, event}`）
- bridge 原实现不检查 sessionId → **用户页面（会话 A）收到测试会话（B/C）的事件** → 消息列表被污染、状态机被其他会话的 turn 事件打乱 → 表现为「模型没有回复」（其实回了，UI 错乱）
- ✅ 修复：`if (payload.sessionId && payload.sessionId !== state.sessionId) return`

### 根因 2：status thinking 占位推进索引越界 → 页面卡死

排查时用 `__appDebug` + 事件日志（App 内 window.__appLog）抓到精确时间线：

```
21:44:15.538 status:placeholder {curLen:16, typing:false}   ← 占位已在尾部（index 15）
            → setShownIndex(messagesRef.current.length) = 16  ← 越界！
```

- 原代码：`setShownIndex(messagesRef.current.length)` → 当**占位已在尾部**（上一次 status thinking 追加过 / reasoning-delta 轰炸第二次进入）时，len=16、占位 index=15 → 推进到 16 → `current = messages[16] = undefined`
- 连锁反应：DialogBox 卸载（`current &&` 为 false）→ **Typewriter 消失** → 「空文本立即完成」逻辑失效 → 后续 status thinking 的 `setTyping(true)` 无人复位 → **typing 永久 true → 页面卡死（无对话框无输入框）**
- ✅ 修复：推进目标 = `tailEmpty ? curLen - 1 : curLen`（尾部已是空占位 → 推进到占位索引 len-1；否则占位将追加 → 目标 = 旧 len）

### 验证（真实浏览器，连续 3 轮发送）

- ✅ 发送「帮我在temp里创建hello.txt，内容写hi」→ 玩家台词 → thinking（占位）→ 完整回复（「已确认 ✅ …内容为 hi」）→ 打字完成 → 回到玩家回合（输入框 855×51 可见）
- ✅ 历史 18 条完整重放、无其他会话污染
- ✅ 状态稳定：shownIndex=17=len-1、typing=false、status=ready

### 排查工具沉淀

- `temp/ws-link-test.mjs`（WS 链路测试）、`temp/eval-ws-capture*.ps1`（事件帧结构捕获）、`temp/eval-app-log.ps1`（App 状态转换时间线日志，window.__appLog）
- App.jsx 内 window.__appLog 记录 user/status/placeholder/model:done/type:complete 关键转换（保留，开发期有用）

---

## 第五轮：模型回复「分页 + 停留」（2026-08-19）

### 用户需求

模型回复**一闪而过、没有停留**。期望：回复停在页面上等待用户 Enter/点击确认，长回复分页（每页 1-2 行），全部页看完才进入玩家回合。

### 根因

- DialogBox 现有 `skipKey={typing ? 1 : 0}`：typing=true 时 skipKey 恒为 1 → Typewriter 立即显示全文 + 立即 onComplete → **模型回复从不打字、直接全文闪现**，停留感消失。

### 实现（App.jsx + DialogBox.jsx + styles.css）

- 新增状态：`pageIndex`（当前页）/ `pageDone`（本页已打完等待确认）/ `skipFirstPageRef`（流式已全文显示过的标记）
- `splitIntoPages(text, maxLines=2, maxChars=80)`：按行分页，超 80 字符按标点（。！？；，、.!?;,）切段；空行跳过
- 交互状态机：打字中点击/Enter → 跳过本页（skipCounter+1）→ 立即全文；页打完后停留（▼ 按 Enter 继续）→ Enter 下一页（打字）→ 页尽下一条消息 → 全部确认 → 玩家回合
- 全局 keydown 监听 Enter/空格（玩家回合/设置面板打开时放行）；用 ref 缓存 isPlayerTurn 防与 PlayerInput 冲突
- 流式全文已显示过（`streamingText === ev.text`）→ 补全后直接显示第一页并停留（不再重打），否则从头打第一页

### 验证（真实浏览器，长回复全流程）

- ✅ 300 字自我介绍：8 页逐页打字/停留/Enter 推进，最后一页确认后进入玩家回合
- ✅ 五言律诗（9 行）：3 页（空行跳过），连按 Enter 中打字时触发跳过（skipCounter=1）→ 快速推进到玩家回合
- ✅ 短回复：1 页 + 停留 → Enter → 玩家回合；skipFirstPage 生效（流式已显示过，不再重打）
- ✅ 历史重放正常（24+ 条无污染），Debug 新增 pageIndex/pageDone 字段

### 调试工具沉淀

- `temp/eval-enter.ps1`（全局 Enter 事件）、`temp/eval-dialog-read.ps1`（对话框文本/停留提示/输入框可见性）、`temp/eval-page-check.ps1`（页面挂载检查）
- 踩坑：useMemo 未 import（运行时 ReferenceError 页面白屏）→ 补 import；isPlayerTurnRef 的依赖数组在 const 定义前求值（TDZ）→ 移到定义后

### 遗留

- [ ] savedAt 刷新后不恢复（header 显示「无存档」但存档位实际存在）——读档按钮可正常恢复，属显示层小问题
- [ ] 工具调用完整演出（技能卡片 + 可展开 diff/参数）
- [ ] approval 审批交互（`POST /api/respond`）
- [ ] 多角色 = 多模型

---

## 第六轮：发消息后一次 Enter 直接跳转（2026-08-19）

### 用户需求

发消息后按一次 Enter 直接跳到下一个对话（模型回复），打字中按 Enter 直接跳转，不需要再按一次才推进。

### 改动

- `handleTypeComplete`：玩家自己的话（role=user）最后一页打完不再停留等待确认 → 自动切到下一条（模型回复/占位）；模型的话才分页停留等待 Enter
- `handleDialogClick`：打字中/流式中 Enter 不再只跳过本页 → 跳过本页并**直接推进**到下一页/下一条/玩家回合（一次 Enter 跳一页）

### 验证（真实浏览器）

- ✅ 发消息「推荐一部科幻电影」→ 用户消息打完自动切到模型回复（不等待确认）→ 回复第一页全文+停留
- ✅ 一次 Enter → 第二页全文+停留 → 一次 Enter → 第三页全文+停留 → 一次 Enter → 玩家回合（全程每按一次跳一页，无多余按键）
- ✅ 长回复（300 字散文/五言律诗）逐页推进正常，打字中 Enter 触发 skip+推进（skipCounter 递增）
- ✅ 历史重放稳定（40+ 条无污染）
- [ ] BGM / 音效

---

## 第七轮：流式按页显示（无全文闪现）+ 字体统一（2026-08-19）

### 用户需求

1. 模型回复先显示长全文、随后突然跳成小段 → 要求一开始就直接按页小段打字
2. 字体大小粗细不一 → 确认三因：markdown 星号乱码 / 中英文混排字体不一致 / 界面各区域字号不统一

### 改动（问题 1：流式按页显示）

- **删除 `skipFirstPageRef`**（全文闪现→分页跳变的根因：流式期间显示全文、done 后从第一页打字）
- 页重置 effect 依赖改为 `[shownIndex]`（消息切换才重置，不再随 pages 重建）
- 新增 `streamingPages = useMemo(splitIntoPages(streamingText))` + `curPages = streamingText ? streamingPages : pages` + `curPagesRef`
- `model:done` 分支：只 `setStreamingText('')` + `setTyping(false)`（不再重置 pageIndex）
- 新增 clamp effect：`!streamingText && pages.length > 0` 时 pageIndex 限到 `pages.length - 1`
- `displayText` 改为 `curPages[pageIndex] || (streamingText ? '…' : '')`；thinking 占位文案只在 `!streamingText && pages.length === 0` 时显示
- `handleDialogClick` / `handleTypeComplete` 改用 `curPagesRef.current.length`

### 改动（问题 2：markdown 清理 + 字体统一）

- 新增 `cleanMarkdown(text)`（`splitIntoPages` 入口统一调用）：去 ``` 代码块、`反引号、`**` 粗体、`*` 斜体、`#` 标题、列表符号（`-`/`*`/`+` → `• `）、`>` 引用、`[t](u)` → `t`
- `styles.css` 字体统一：
  - body 字体栈 `'Microsoft YaHei'` 提前（Windows 中英文混排统一观感），font-weight 400 基准
  - 字号规范：对话框正文 17px / 输入框 16px / 按钮·toast·分区标题 14px / 辅助小字 13px（`.dialog-advance` 12→13、`.settings-ref-line` 12→13、`.player-input-hint` 12→13、`.input-field` 15→16）；主标题 20px 700 保留

### 验证（真实浏览器）

- ✅ 300 字「秋天的黄昏」回复：直接第一页小段打字（无全文闪现）→ Enter 逐页推进 → 玩家回合
- ✅ markdown 清理：历史重放与回复显示均无 `**`/`-` 星号（秋天散文标题、律诗列表均干净）
- ✅ 一次 Enter 跳一页在流式期间生效（skipCounter 递增），80 连按 Enter 可快速跳过整段历史
- ✅ 状态机回归正常（用户消息自动切模型回复、页停留、玩家回合）
- ⚠️ 测试环境发现：opencli 会话标签 `active:false`（后台）→ 浏览器节流打字与 React 渲染提交 → DOM 渲染滞后（state 正常但 DOM 停在旧帧）→ 属测试环境限制，用户前台使用无影响；后续测试尽量在浏览器前台会话做

### 遗留

- [ ] 字体统一效果的浏览器前台视觉确认（用户自查）
- [ ] 后台节流下的测试方案（尽量前台会话 / 减少流式高频渲染查询）
- [ ] 原有遗留：savedAt 显示、工具演出、approval、多角色、BGM

---

## 第八轮：修复「模型话一次性全部呈现」（2026-08-19）

### 用户反馈

有时模型的话不是流式逐字呈现，而是一次性全部出现。

### 根因（确定性路径）

1. 用户消息打完自动切到模型**占位**（空文本）→ Typewriter 空文本 effect 立即触发 `onComplete` → `handleTypeComplete` 的 **250ms 定时器**到期时若流式已开始（模型回得快）→ `curPages.length > 0` → `setPageDone(true)`
2. `skipSignal={skipCounter + (pageDone ? 1 : 0)}` —— pageDone 变化即 skipSignal 变化 → Typewriter 的 **skip effect 把 count 直接拉满**（全文显示 + onComplete）→ **整页一次性呈现**，打字动画被吞

### 改动

- `App.jsx`：`skipSignal={skipCounter}`（移除 pageDone 偏移——pageDone 状态变化不再触发 skip）
- `App.jsx`：`handleTypeComplete` 的 `setPageDone(true)` 加 `!streamingTextRef.current` 保护（流式期间绝不设停留态）；定时器 250ms → 0ms（缩小与推进的竞态窗口）
- `Typewriter.jsx`：文本变化 effect 增加内容比较——引用变但内容相同时保持打字进度（done 后切 pages 引用变化但内容一致时不再整页重打）

### 行为变化说明

- 修复后：停留页按 Enter 推进 → 新页**从头逐字打字**（原来 skipSignal 联动会直接把新页全文显示）
- 打字中 Enter 仍是「跳过+推进」（skipCounter 触发 skip，预期保留）
- 流式期间不再出现提前的 ▼ 停留提示（打完再显示）

### 验证

- ✅ `npm run build` 通过
- ⚠️ 测试环境（opencli 后台标签节流 1s/字 + CDP 超时）无法可靠做流式时序的 UI 验证——根因分析闭环（唯一能把 count 拉满的外部信号是 skip effect，现已与 pageDone 解耦）；请用户前台浏览器发消息确认逐字动画

### 遗留

- [ ] 前台浏览器确认：回复始终逐字、无一次性、无提前 ▼
- [ ] 原有遗留全部保留