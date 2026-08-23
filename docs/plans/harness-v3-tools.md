# Harness 工具层 v3：门类化 + 可扩展可外接（对标 Hermes/OpenCode）

> 目标：工具层达到成熟 agent 标准——门类清晰、渐进披露、一切可拓展可外接，不靠改源码加工具。
> 参考：Hermes（toolsets/插件/MCP 配置化/shell+HTTP 工具/check_fn）、OpenCode（provider 无关 + 目录式工具）

## 一、现状差距（v2 → v3）

| 能力 | Hermes | Kotonoha v2 | v3 目标 |
|------|--------|------------|---------|
| 门类分组 | toolsets（按用途组合，渐进披露） | 平铺 14 工具 + group 标签 | **toolsets 工具集**：core/dev/web/memory/mcp，按会话需求加载 |
| 加工具方式 | 插件目录 / MCP 配置 / tool.yaml | 只能改源码 | **插件系统 + 配置驱动** |
| 外接能力 | MCP 配置化 + shell 脚本工具 + HTTP API 工具 | MCP 客户端（代码注册） | **配置化 MCP + shell 工具 + HTTP 工具** |
| 注册 | 自发现（registry.register 顶层调用） | 手动 import | **目录扫描自发现** |
| 可用性 | check_fn 门控（平台/环境判断） | 无 | **check 函数** |
| 披露 | 渐进式（按需加载 schema） | 全部平铺给模型 | **按 toolset 组合，减小 prompt 体积** |

## 二、v3 架构

```
agent/
├── tools/
│   ├── registry.ts        # 自发现注册 + check_fn 门控（改造）
│   ├── protocol.ts        # 现有（保留）
│   ├── toolsets.ts        # ★ 工具集定义：名称/描述/包含工具/加载条件
│   ├── discover.ts        # ★ 目录扫描：builtin/*.ts + plugins/* 自动注册
│   ├── plugins/           # ★ 插件目录（用户可放，含 manifest + 工具）
│   │   └── example/       #   示例插件（展示完整写法）
│   ├── external/
│   │   ├── shell-tool.ts  # ★ 配置驱动：tool.yaml → shell 命令工具
│   │   ├── http-tool.ts   # ★ 配置驱动：tool.yaml → HTTP API 工具
│   │   └── yaml-loader.ts # ★ 解析工具配置清单
│   ├── builtin/           # 现有 14 工具（重组到 builtin/ 目录）
│   └── hooks.ts/checkpoint.ts  # 现有保留
├── mcp/
│   ├── config.ts          # ★ mcp_servers 配置表（settings 存储，可增删）
│   └── client.ts          # 现有（按配置表连接）
```

## 三、门类划分（toolsets）

| 工具集 | 用途 | 包含工具 |
|--------|------|----------|
| **core**（默认） | 通用基础 | read_file/grep/glob/bash/task/execute_skill/kotonoha_checkpoint/undo |
| **dev** | 开发工作 | write_file/edit_file/run_command/git_status/git_commit/git_log |
| **web** | 联网 | fetch_url/web_search |
| **memory** | 记忆/技能 | execute_skill（自定义技能）+ memory 工具 |
| **mcp:<name>** | 外接 | 对应 MCP server 的工具（动态生成） |
| **plugins:<name>** | 插件 | 插件注册的工具 |

- 会话默认 core + dev；模型/用户可用 `toolsets.set` 切换（rpc）
- 渐进披露：prompt 只带当前激活工具集的 schema

## 四、外接机制（三种，全部不写核心代码）

### 1. 插件（plugins/）
```
agent/tools/plugins/my-tool/
├── plugin.yaml     # name, description, tools:[...]
└── index.ts        # register(ctx): ctx.registerTool({name, schema, run})
```
- 扫描 `tools/plugins/*/` 自动加载（开发期目录；后续用户级 `~/.kotonoha/plugins/`）
- 插件可用 ctx API：registerTool / registerHook

### 2. Shell 工具（tool.yaml 配置）
```yaml
tools:
  - name: weather
    description: 查天气
    type: shell
    command: "python scripts/weather.py {location}"   # {arg} 插值
    cwd: ./
    timeout: 30
```
- yaml-loader 解析 → 生成 Tool（exec 执行命令，输出作为结果）

### 3. HTTP API 工具（tool.yaml 配置）
```yaml
tools:
  - name: github_issue
    description: 创建 GitHub issue
    type: http
    method: POST
    url: "https://api.github.com/repos/{repo}/issues"
    headers: { Authorization: "Bearer {env:GITHUB_TOKEN}" }
    body: { title: "{title}", body: "{body}" }
```
- 参数从 {arg} 占位符声明，生成 JSON Schema

### 4. MCP 配置化（mcp_servers 表）
- settings 存 `mcp:servers` = [{id, type:stdio/sse, command?, url?, args?}]
- 启动时按配置表连接，工具自动进 `mcp:<id>` 工具集
- rpc：`mcp.servers.list` / `mcp.servers.add` / `mcp.servers.remove` / `mcp.servers.connect`

## 五、注册表改造

- **自发现**：`discover()` 扫描 builtin/ + plugins/ 目录，模块顶层注册即收录
- **check_fn**：Tool 加可选 `check(ctx?) => boolean|Promise<boolean>`，false 则不出现在模型 schema（如 git 工具在非 git 目录隐藏）
- **toolsets**：`listToolsets()` / `getActiveToolsets(session)` / `setToolsets(session, names)`；engine 组装 schema 时只含激活工具集

## 六、任务分解（子 agent）

| 批次 | 子 agent | 任务 | 依赖 |
|------|----------|------|------|
| ① | T1-toolsets | toolsets.ts + registry 改造（自发现+check_fn+激活集）+ rpc toolsets.* | 无 |
| ① | T2-external | shell-tool/http-tool/yaml-loader + 示例配置 + 测试 | 无 |
| ① | T3-plugins | plugins 扫描 + plugin.yaml + ctx API + 示例插件 | 无 |
| ② | T4-mcp-config | mcp_servers 配置表 + rpc + 启动连接 | T3（复用 plugin ctx 概念） |
| ③ | 集成 | 全量验收 + 前端 ESC 技能页联动 | 全部 |

## 七、验收标准

1. `npx tsc --noEmit` 零错误；verify-all 19/19 无回归
2. 三类外接（插件/shell/HTTP）各加一个真实工具，模型对话中可调用
3. toolsets 切换生效：core+dev 激活时 prompt schema 只含对应工具
4. check_fn 生效：非 git 目录时 git 工具从 schema 隐藏
5. MCP 配置化：配置文件加一个 server → 启动自动连接 → 工具出现在 mcp:<id> 集
6. 现有 14 工具全部保留可用

## 八、风险

| 风险 | 对策 |
|------|------|
| 插件代码执行安全 | 插件仅限可信目录（项目内/用户显式添加），文档注明 |
| HTTP 工具密钥泄露 | {env:VAR} 占位符，密钥不落配置明文 |
| toolset 切换影响现有会话 | 默认全开（core+dev+web+memory），切换是增量优化 |
| yaml 解析依赖 | 用已有依赖或手写最小解析器（避免新增重依赖） |