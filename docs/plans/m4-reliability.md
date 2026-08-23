# M4：Provider 可靠性——降级链接线 + 健康检查

> 现状：fallback.ts（executeWithFallback）与 registry fallbackChain 已实现但**未接线**；
> agent.ts 仍用单一 provider。4.1 成本/4.3 中断已完成。
> 目标：主 provider 失败（网络/5xx/429/超时）自动切降级链，全程通知前端。

## 任务

### 1. agent.ts 接线降级链（核心）
- TurnRunner 里 `provider.streamChat` 包 `executeWithFallback`：
  - 主 provider = session.provider，fallback = registry.getFallbackChain() 中其余可用 provider
  - 触发条件：网络错误 / HTTP 5xx / 429 / 流中断 / 超时（>60s 无 chunk）
  - 不触发：模型业务错误（400 参数错误——切换无用）
  - 切换后：会话 model 保持用户选的，但 provider 临时降级（不污染 session.provider）；或提示用户
- 降级时广播事件：`assistant/chunk {type:'finish', reason:{kind:'degraded', from, to, message}}`——前端 bridge 识别后显示「已降级到 xx」toast（bridge 需小改：handleFinish 或 handleTurnError 处理 degraded）
- 降级记录落库：settings 表 `degradations`（ts, from, to, reason）——可被 stats 查询

### 2. provider 健康检查调度
- providers registry 增加 `healthCheckAll()`：遍历 providers，healthCheck() 探活（5s 超时），维护可用状态 map
- agent 启动时 + 每 10 分钟跑一次；不可用 provider 从降级链剔除（临时）
- 恢复：下次检查通过后重新加入

### 3. RPC/事件
- 事件：degraded 帧（见上）
- rpc：`stats.degradations`（ops 注入，返回降级记录）——前端统计页可展示
- 可选：`providers.health`（返回各 provider 状态）

### 4. 前端（bridge 小改）
- handleTurnError 或新 handler：收到 degraded 帧 → toast「模型降级：xx → yy」
- 统计页加「降级记录」区（stats.degradations）

## 验收
1. `npx tsc --noEmit` 零错误；verify-all 19/19 无回归
2. 测试：mock 主 provider 抛错 → 自动切 fallback（fake 成功 provider）→ 对话继续；降级记录落库
3. 真实场景：把主 provider baseURL 指到坏端点 → 对话仍成功（fallback 生效）
4. 前端 build 通过 + degraded toast 逻辑就位

## 任务划分
- 子 agent A：后端（agent.ts 接线 + healthCheck 调度 + RPC + 事件）
- 子 agent B：前端（bridge degraded 处理 + 统计页降级区）——依赖 A 的事件格式，可并行（约定格式）

## 约束
- 不破坏现有协议（degraded 是新增 finish reason，现有 stop/error 不变）
- 降级不改变 session.provider 持久值（用户选择优先）
- 中文注释