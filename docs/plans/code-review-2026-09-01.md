# 代码审查与结构优化（2026-09-01）

> 目标：全量代码审查——结构优化、去冗余、统一规范。**行为零变更**（纯重构，verify-all 19/19 + build 通过为硬验收）。

## 一、盘点结论

### 后端（agent/）
| 问题 | 位置 | 处理 |
|------|------|------|
| 遗留调试文件 | `test-glob2.ts`（根目录）、`src/tools/__tests__/debug-glob*.test.ts`（2个） | 删除 |
| console.log 散落 | 14 处（emotion/plugins/health 等） | 统一为带 `[模块]` 前缀的规范输出或删除 |
| index.ts 过大 | 616 行（loadDeps 组装逻辑集中） | 拆分：组装逻辑抽到 `src/bootstrap.ts`，index.ts 只留 main |
| types.ts 混杂 | 365 行（协议/引擎/API/存储混一起） | 分区注释已有；保持单文件（契约源），仅清理死类型 |
| 重复 require 类型断言 | index.ts 里 10+ 处 `require(...) as {...}` | bootstrap.ts 统一管理 |
| store/index.ts 死代码 | buildDefaultStore 的 compressSession 永远 throw（已由 compressSessionStore 替代） | 清理 |

### 前端（app/）
| 问题 | 位置 | 处理 |
|------|------|------|
| **EscapePanel 巨石组件** | 1604 行、39 useState、13 useEffect | **拆分**：每页签独立组件文件（panels/SavePanel.jsx 等 9 个），EscapePanel 变壳 |
| bridge.js 巨石 | 853 行、36 个重复 try/catch api 包装 | 抽 `makeApi(method)` 工厂消除重复；按域拆分文件（chat/sessions/tools/stats） |
| App.jsx 过大 | 835 行（事件处理+页面路由+状态全在内） | 抽事件处理 hook（useBridgeEvents）+ 页面组件拆分 |
| temp 探测脚本入库 | app/temp/probe-v2v3.js | 删除或移 scripts |
| console.log | 6 处 | 清理 |

### 规范统一
- 后端日志：`console.warn('[模块名] ...')` 格式，去掉无前缀 log
- 前端组件：单文件 ≤300 行原则，hooks 抽离
- 死代码零容忍

## 二、任务分派（3 个并行子 agent）

| 子 agent | 范围 | 硬性验收 |
|----------|------|----------|
| R1-backend | agent/src 全部：删调试文件、日志规范、index.ts→bootstrap 拆分、store 死代码清理 | tsc 0 错误 + verify-all 19/19 + dist 重建 |
| R2-frontend | app/src：EscapePanel 拆 9 个 panel 组件、bridge.js makeApi 工厂、App.jsx 抽 useBridgeEvents、删 temp 脚本 | vite build 通过 + 现有功能路径不变 |
| R3-docs | 根目录 README 校对 + docs/plans 索引更新（可选轻量） | — |

**不做**：改协议、改行为、加功能。纯结构等价重构。

## 三、集成验收
1. `npx tsc --noEmit` 零错误
2. `node scripts/verify-all.mjs` 19 PASS / 0 FAIL
3. `npm run build` 通过
4. 真实对话一轮验证（情绪+工具+审批链路）
5. 提交（单 commit：refactor）