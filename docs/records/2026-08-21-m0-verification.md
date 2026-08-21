# 2026-08-21 M0 后端验收 + 前端回归

## 里程碑
Agent Harness M0 **后端验收全部通过** + **前端浏览器回归通过**（vite dev + opencli 自查）。

---

## 后端验收清单 ✅

| 项目 | 状态 | 备注 |
|------|------|------|
| 会话 API (create/list/rename/fork/selectModel/delete/history) | ✅ | fork 返回新会话、delete 幂等 |
| 流式对话 (text-delta → finish{stop}) | ✅ | 真实 DeepSeek 调用，言叶人设生效 |
| 落库 (SQLite + WAL) | ✅ | user/assistant 消息可读回 |
| 工具循环 (git_status/read_file/run_command) | ✅ | 真实执行 + 二轮续写 |
| 审批 allowed-once / rejected | ✅ | 拒绝后模型感知并换方案 |
| 协议兼容 dsh | ✅ | bridge.js 零改动，前端直连 |

---

## 关键修复

1. **package.json BOM** → tsx 崩溃 → 重写无 BOM
2. **better-sqlite3 二进制缺失** → `npm rebuild better-sqlite3` (npmmirror 镜像) 解决
3. **secrets.enc 路径写错** (E:\agent) → 修正为 E:\Kotonoha\agent\data
4. **tool_calls 回传缺失** → 契约加 `ChatMessage.toolCalls` + openai-compat 序列化 + agent 组装
5. **enterStory 旧 sessionId 失效不报错** → `bridge.js` 检查 `result.ok`，失效走 `session.create` 分支

---

## 前端回归 (vite dev + opencli)

| 流程 | 结果 |
|------|------|
| 主菜单 4 入口 | ✅ |
| 载入存档 → 项目选择 → 存档选择 | ✅ (修复生效) |
| 对话页 输入/发送/记录/设置 | ✅ |
| 工具调用 (git_status/read_file/run_command) | ✅ 真实执行 + 模型续写 |
| 审批 allow-once | ✅ |
| 打字机流式 (▼ 按 Enter 继续) | ✅ |
| ESC 9-tab 面板 | ✅ 存档/模型/技能/会话/Git/MCP/命令/凭据/统计 |
| 设置面板 | ✅ 文本速度/背景/立绘/模型密钥 |

---

## 文件变更

### 新增/重写
- `agent/` 整个目录 (TypeScript harness M0)
- `docs/plans/agent-harness-m0.md` 规划文档
- `docs/research/agent-features-2026-08-20.md` 调研报告
- `docs/records/2026-08-21-m0-verification.md` (本记录)

### 修改
- `agent/src/types.ts` 加 `ChatMessage.toolCalls`
- `agent/src/providers/openai-compat.ts` 序列化 tool_calls
- `agent/src/core/agent.ts` 组装 assistant toolCalls
- `app/src/bridge/bridge.js` enterStory 检查 result.ok
- `app/package.json` (无 BOM 重写)
- 清理 `E:\agent` 误写目录

---

## 提交

```bash
git add -A
git commit -m "M0: agent harness verified + frontend regression passed

- Agent Harness M0 后端验收全部通过 (会话/流式/工具/审批/落库)
- 前端浏览器回归通过 (vite dev + opencli 全流程)
- 修复 enterStory 旧 sessionId 失效自动创建新会话
- 协议兼容 dsh，bridge.js 零改动
"
git -c http.proxy=http://127.0.0.1:7890 push origin main
```