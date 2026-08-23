# 前端 UI 联动 Harness v2/v3（2026-08-23）

> 目标：把 harness 新能力接入视觉小说 UI——工具集切换、外接工具展示、技能批准、成本统计、会话搜索、中断。
> 原则：不破坏现有交互（对话/存档/审批），新增为扩展。

## 后端已有 RPC（bridge 需补对应方法）

| RPC | payload → value | 状态 |
|-----|-----------------|------|
| `tools.list` | {} → {tools} | ✅ bridge 已有 |
| `toolsets.list` | {} → {toolsets} | ❌ bridge 缺 |
| `toolsets.active` | {sessionId} → 当前激活集 | ❌ 缺 |
| `toolsets.set` | {sessionId, names} → {ok} | ❌ 缺 |
| `session.search` | {sessionId, query, limit?} → {results} | ❌ 缺 |
| `session.interrupt` | {sessionId} → {ok} | ❌ 缺 |
| `stats.cost` | {} → {total, bySession} | ❌ 缺 |
| `memory.list` | {sessionId?} → {memories} | ❌ 缺 |
| `skills.list` | {} → {skills}（含 pending） | ❌ 缺 |
| `skills.approve` | {id} → {ok} | ❌ 缺 |
| `skills.reject` | {id} → {ok} | ❌ 缺 |
| `session.trajectory` | {sessionId} → {trajectory} | ❌ 缺 |

## UI 改动（按页签）

### 1. 技能页签（EscapePanel skills）
- 顶部：**工具集切换**（core/dev/web/memory 多选 chip，调 toolsets.set，保存到当前会话）
- 工具列表增强：来源标识（内置/插件/外接/checkpoint 徽章）+ readOnly 标记
- **待批准技能区**：skills.list 的 pending 项，显示名称+摘要，「批准/拒绝」按钮（skills.approve/reject）——批准后进 execute_skill 可选列表

### 2. 会话页签（EscapePanel session）
- 增加**搜索框**：输入 → session.search → 结果列表（匹配事件摘要+时间），点击跳到对话（或至少展示）
- 增加**中断按钮**：当前会话 busy 时显示「停止生成」，调 session.interrupt

### 3. 统计页签（EscapePanel stats）
- **成本统计**：stats.cost → 总费用 + 按会话列表（tokens/费用）
- **轨迹审计**（可折叠）：session.trajectory → 最近工具调用记录（工具名/参数摘要/结果）

### 4. 记忆展示（可并入技能页或新增子区）
- memory.list → 语义记忆列表（实体-关系-详情）
- 与「羁绊」概念结合：展示为「言叶记得的事」

### 5. 对话页（App.jsx）
- 思考中（status=thinking/action）时输入区上方显示**「停止」按钮** → session.interrupt

## bridge.js 新增方法（10 个）

```js
listToolsets()          // toolsets.list
getActiveToolsets(sid)  // toolsets.active
setActiveToolsets(sid, names) // toolsets.set
searchSession(sid, query, limit) // session.search
interruptSession(sid)   // session.interrupt
getCostStats()          // stats.cost
listMemories(sid)       // memory.list
listSkills()            // skills.list
approveSkill(id) / rejectSkill(id)
getTrajectory(sid)      // session.trajectory
```

## 验收
1. `npm run build` 通过
2. ESC 各页签新控件渲染正常（opencli/CDP 验证）
3. bridge 方法调用后端返回正确结构
4. 现有流程（对话/存档/审批/更新）无回归

## 任务划分
- **U1-bridge**：bridge.js 加 10 个方法（纯协议层）
- **U2-esc**：EscapePanel 技能/会话/统计页签改造 + 记忆展示
- **U3-dialog**：对话页停止按钮
- （U1 完成后 U2/U3 可并行；或一个 agent 全做，量适中）

## 约束
- 不改后端 rpc（已就绪）
- 样式复用现有 ep-/settings- 体系，类名前缀扩展
- 中文注释、函数式组件 + hooks