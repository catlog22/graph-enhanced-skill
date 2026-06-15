# Graph-Enhanced Skill Standard (GES) v1.0

> 将 skill 内部的状态机从散文描述提升为 YAML 图结构。
> SKILL.md 不变，`.ges.yaml` 叠加增强。
> 5 分钟上手，action 只需区分 `prompt`（LLM 做）和 `run`（工具做）。

---

## 1. 核心概念——只有 3 个

```
节点（node）  = 状态，包含有序 actions
边（edge）    = 转移，when 条件决定走哪条
动作（action）= prompt（LLM 执行）或 run（命令/工具执行）
```

**认知模型**：写一个 `.ges.yaml` 就像画流程图——节点是框，边是箭头，每个框里是要做的事。

## 2. 文件结构

```
.claude/commands/
  odyssey-planex.md                # SKILL.md（不变）
  odyssey-planex.ges.yaml          # GES 图定义
  odyssey-planex/
    prompts/                       # 外部 prompt 文件（可选）
      intake.md
      verify.md
```

执行器检测 `.ges.yaml` 存在即进入 GES 模式。无则走原有 SKILL.md 逻辑。

---

## 3. 完整 Schema

```yaml
schema: ges/1.0

meta:
  name: odyssey-planex
  entry: intake
  terminal: [end]                  # 隐式节点，不在 nodes 中定义

# ── 工具别名 ── 纯字符串映射，平台切换只改这里
bindings:
  analyzer: "maestro delegate --role analyze --mode analysis"
  reviewer: "maestro delegate --role review --mode analysis"
  searcher: "maestro search --json"

# ── 节点 ──
nodes:
  intake:
    actions:
      - id: parse
        prompt: 解析 $ARGUMENTS，生成 slug，创建 SESSION_DIR

      - id: define_criteria
        prompt: ./prompts/intake.md            # 外部文件：长 prompt
        output: [acceptance_criteria]
        verify: "acceptance_criteria.length >= 1"

      - id: search_prior
        run: "searcher '{{keywords}}'"         # 引用 binding 别名
        output: [prior_knowledge]
        optional: true

  plan:
    actions:
      - id: cli_assist
        run: "analyzer"
        prompt: ./prompts/plan-delegate.md     # run + prompt = 工具执行 + prompt 传入
        output: [plan_suggestion]

      - id: finalize
        prompt: 整合 {{plan_suggestion}}，生成执行计划

  execute:
    actions:
      - id: implement
        prompt: 按计划实现代码变更
        loop: { over: "{{plan.tasks}}", as: task }

  verify:
    actions:
      - id: check
        prompt: ./prompts/verify.md
        loop: { over: "{{acceptance_criteria}}", as: criterion }

      - id: summarize
        prompt: 汇总 pass/fail 表

  fix:
    actions:
      - id: targeted_fix
        prompt: 对每个 failed criterion 诊断并修复
        loop: { over: "{{failed_criteria}}", as: criterion }

      - id: review
        run: "reviewer"
        prompt: ./prompts/fix-review.md
        output: [fix_verdict]

  generalize:
    actions:
      - id: extract
        prompt: 从实现中提取可复用模式（syntax/semantic/structural）

      - id: scan
        run: "analyzer"
        prompt: 扫描全项目，查找与提取模式相似的代码
        output: [scan_results]

  record:
    actions:
      - id: summarize
        prompt: 总结迭代过程，输出建议的知识持久化命令

      - id: completion
        prompt: 输出 completion summary

# ── 边 ──
edges:
  - { from: intake,  to: intake,     when: "no_requirement" }
  - { from: intake,  to: plan,       when: "criteria_defined" }
  - { from: plan,    to: execute }
  - { from: execute, to: verify }
  - { from: verify,  to: end,        when: "all_passed && skip_generalize" }
  - { from: verify,  to: generalize, when: "all_passed" }
  - { from: verify,  to: fix,        when: "some_failed && iteration < max" }
  - { from: verify,  to: record,     when: "some_failed && iteration >= max" }
  - { from: fix,     to: verify }
  - { from: generalize, to: record }
  - { from: record,  to: end }
```

---

## 4. Action——只有两种模式

| 字段 | 含义 |
|------|------|
| `prompt` | LLM 执行的指令。字符串=内联指令，路径=外部 `.md` 文件 |
| `run` | 工具/命令执行。引用 bindings 别名或直接写命令 |

**组合规则**：

```yaml
# 模式 1：纯 LLM（prompt only）
- prompt: 分析需求，推导验收标准

# 模式 2：纯工具（run only）
- run: "npm test"

# 模式 3：工具 + prompt（run 执行工具，prompt 作为输入传给工具）
- run: "analyzer"
  prompt: ./prompts/plan-delegate.md

# 模式 4：LLM + 命令验证（prompt 执行，run 验证）
- prompt: 实现功能
  verify:
    run: "npm test"
```

### 4.1 Action 核心字段

| 字段 | 必需 | 说明 |
|------|------|------|
| `id` | 是 | 节点内唯一标识 |
| `prompt` | 二选一 | LLM 指令（字符串或 `./path.md`） |
| `run` | 二选一 | 工具命令（binding 别名或直接命令） |
| `output` | 否 | 产出的变量名列表，后续 action 可通过 `{{var}}` 引用 |
| `verify` | 否 | 完成验证——字符串（LLM 判断）或 `{ run: "cmd" }`（命令验证） |

### 4.2 Action 扩展字段（按需引入）

| 字段 | 说明 | 何时用 |
|------|------|--------|
| `loop` | `{ over, as }` 迭代执行 | 逐条处理列表 |
| `optional` | `true` = 失败不阻塞 | 可选的辅助步骤 |
| `retry` | 重试次数 | 不稳定的外部调用 |
| `timeout` | 超时毫秒 | 长时间运行的命令 |
| `tools` | 临时决策工具 schema（仅 run 模式） | Agent 需返回结构化结果 |

### 4.3 verify——两种模式

```yaml
# LLM 自判断（默认）
verify: "acceptance_criteria.length >= 1"

# 命令验证
verify:
  run: "npm test -- --filter={{criterion.pattern}}"
```

### 4.4 tools——临时决策工具（扩展字段）

当 `run` 执行的是 Agent/LLM 工具时，可注入临时 schema 要求结构化返回：

```yaml
- id: quality_gate
  run: "reviewer"
  prompt: ./prompts/quality-check.md
  tools:
    - name: verdict
      schema:
        type: object
        required: [pass, confidence]
        properties:
          pass: { type: boolean }
          confidence: { type: number }
          gaps: { type: array, items: { type: string } }
  output: [verdict]
```

工具仅在当前 action 生命周期内存在。Agent 必须调用该工具返回结果。

---

## 5. 边——条件转移

```yaml
edges:
  - from: verify
    to: fix
    when: "some_failed && iteration < max"
```

| 字段 | 必需 | 说明 |
|------|------|------|
| `from` | 是 | 源节点 |
| `to` | 是 | 目标节点 |
| `when` | 否 | 条件表达式（空 = 无条件，即 default） |

**求值规则**：
- `when` 字符串由 LLM 读取上下文判断 true/false（self 模式）
- 从同一节点出发的多条边按数组顺序求值，first match wins
- 全部不匹配 = STUCK 错误

**求值上下文**（LLM 可见）：
- `graph-state.yaml` 中的 `variables`
- `session.json` 中的业务状态
- `flags`（命令行标志）

---

## 6. Bindings——工具别名

```yaml
bindings:
  analyzer: "maestro delegate --role analyze --mode analysis"
  reviewer: "maestro delegate --role review --mode analysis"
```

**就是字符串别名**。`run: "analyzer"` 展开为 `run: "maestro delegate --role analyze --mode analysis"`。

**平台切换**——只改 bindings，图不变：

```yaml
# maestro
bindings:
  analyzer: "maestro delegate --role analyze"

# aider
bindings:
  analyzer: "aider /architect"

# 直接 API（通过 wrapper 脚本）
bindings:
  analyzer: "./scripts/call-api.sh analyze"
```

**不限于 CLI**——api/sdk/agent 调用通过 wrapper 脚本封装为命令即可，不需要在 GES 标准中定义 HTTP/SDK 细节。

---

## 7. 输入 Schema

每个 skill 可声明输入契约，用于交接验证和自文档化：

```yaml
meta:
  name: deploy
  entry: prepare
  terminal: [done]
  input:                               # JSON Schema 子集
    type: object
    required: [artifact_path]
    properties:
      artifact_path: { type: string, description: "构建产物路径" }
      environment:   { type: string, default: staging }
      version:       { type: string }
```

**规则**：
- `meta.input` 可选——无声明的 skill 接受任意输入
- 格式为 JSON Schema 子集（`type`, `required`, `properties`, `default`, `description`）
- 执行器在 `INIT` 时用输入 schema 验证初始 variables
- 交接（handoff）时目标 skill 的 input schema 用于验证 payload

---

## 8. 运行时状态（graph-state.yaml）

```yaml
schema: ges-runtime/1.0
source: odyssey-planex.ges.yaml

current_node: verify
current_action: check
iteration: 2

variables:
  acceptance_criteria: [...]
  plan_suggestion: { ... }
  prior_knowledge: { ... }

call_stack: []

handoff: null                          # 或 { target, payload, status }
```

历史记录交给 `evidence.ndjson`，不膨胀状态文件。

### 8.1 嵌套 skill_call（调用-返回）

```yaml
# run 引用 .ges.yaml → 自动识别为 skill_call
- id: deep_analyze
  run: ./planex.ges.yaml
  prompt: "{{sub_requirement}}"        # → 子图 _input 变量
  output: [planex_result]              # 仅这些 key 从子图冒泡回父
```

**语义**：call/return——子图跑完后父图继续。

- 子图独立状态文件 `graph-state.{child_name}.yaml`
- variables 互不污染，仅 `output` 声明的 key 冒泡
- `prompt` 传入子图作为 `_input` 变量
- `call_stack` 记录调用帧，支持断点恢复

### 8.2 交接 handoff（控制权转移）

```yaml
edges:
  - from: record
    to: end
    handoff:                           # 到达终态时建议交接
      target: ./deploy.ges.yaml
      map:                             # 当前 variables → 目标 input 映射
        artifact_path: "{{build_output}}"
        environment: production
        version: "{{release_version}}"
```

**语义**：transfer——当前 skill 结束，控制权永久转移到目标 skill，不回来。

| | 嵌套 skill_call | 交接 handoff |
|---|---|---|
| 触发 | `run: ./child.ges.yaml` | edge 上的 `handoff` 字段 |
| 控制流 | call → child runs → return → parent continues | current ends → target starts |
| 数据 | `prompt` → `_input`；`output` keys 冒泡 | `map` 映射 → 目标 `meta.input` 验证 |
| 状态 | 子图独立文件，父 call_stack 记录 | 当前 session 标记 `handed_off`，新 session 创建 |

**执行器协议**：

```
当 edge 匹配且含 handoff：
  1. payload = expand(handoff.map, current_variables)
  2. target_graph = load(handoff.target)
  3. if target_graph.meta.input → validate(payload, input_schema)
  4. state.handoff = { target, payload, status: "pending" }
  5. PERSIST → current session 到达终态

用户执行 `ges handoff <session-id>`：
  1. 读取 state.handoff
  2. 创建目标 session，payload 注入为初始 variables
  3. 标记源 session handoff.status = "accepted"
```

**`ges next` 行为**——当 session 到达终态且有 pending handoff：

```
Done. Session reached terminal "end".

Handoff → deploy (./deploy.ges.yaml)
  Payload: { artifact_path: "/dist/bundle.js", environment: "production" }

  Accept: ges handoff <session-id>
  Skip:   ges handoff <session-id> --skip
```

---

## 9. 执行器协议

```
LOAD skill.ges.yaml
EXPAND bindings（别名 → 完整命令）
INIT graph-state.yaml { current_node: meta.entry }
  if meta.input → VALIDATE(initial_variables, meta.input)

LOOP:
  node = nodes[current_node]

  for action in node.actions (from current_action):

    if action.run is *.ges.yaml:
      # skill_call（嵌套）
      child = LOAD(action.run)
      child.variables._input = resolve(action.prompt)
      child_state = child.RUN()
      for key in action.output:
        variables[key] = child_state.variables[key]

    elif action.run && action.prompt:
      cmd = expand(action.run)
      input = load_prompt(action.prompt)
      result = exec(cmd, stdin=input)

    elif action.run:
      result = exec(expand(action.run))

    elif action.prompt:
      instruction = load_prompt(action.prompt)
      result = llm_execute(instruction + context)

    if action.loop:
      for item in evaluate(action.loop.over):
        execute_action_with(item as action.loop.as)

    if action.output:
      for key in action.output:
        variables[key] = extract(result, key)

    if action.verify:
      if verify is string → llm_judge(verify, context) → bool
      if verify.run → exec(verify.run) → exit_code == 0

    mark action done → PERSIST graph-state.yaml

  # 转移
  matched_edge = null
  for edge in edges where from == current_node:
    if !edge.when || llm_judge(edge.when, context):
      matched_edge = edge
      break
  if !matched_edge → ERROR: STUCK

  # 交接检查
  if matched_edge.handoff:
    payload = expand(matched_edge.handoff.map, variables)
    target = load(matched_edge.handoff.target)
    if target.meta.input → validate(payload, target.meta.input)
    state.handoff = { target, payload, status: "pending" }

  current_node = matched_edge.to
  if current_node in meta.terminal → END (with optional handoff pending)
```

### 9.1 持久化

遵循 Protected Data Store 模式：`lock → backup → write temp → rename → unlock`。每个 action 完成后持久化，支持断点恢复。

---

## 10. 与 SKILL.md 的共存

| 场景 | 行为 |
|------|------|
| 有 `.ges.yaml` + 执行器支持 | 按图执行，SKILL.md 作为完整参考 |
| 有 `.ges.yaml` + 无执行器 | LLM 读 SKILL.md（现有行为） |
| 无 `.ges.yaml` | 纯现有行为 |

---

## 11. 从 SKILL.md 迁移

```
<states> 中的状态    → nodes 下的 key
<transitions> 的转移  → edges
A_* 中的步骤         → node.actions
"spawn agent"        → run: "binding-name"
"maestro delegate"   → run: "binding-name" + prompt
phase_goals          → action.verify（节点完成即目标达成）
skip_when            → edges 条件跳过
长 prompt 段落       → ./prompts/*.md
```

---

## 12. 示例

### 12.1 最小 GES

```yaml
schema: ges/1.0
meta: { name: hello, entry: start, terminal: [end] }
nodes:
  start:
    actions:
      - id: do
        prompt: 执行任务
edges:
  - { from: start, to: end }
```

### 12.2 带循环

```yaml
edges:
  - { from: do,    to: check }
  - { from: check, to: end,  when: "quality_ok" }
  - { from: check, to: do,   when: "!quality_ok && retries < 3" }
  - { from: check, to: end,  when: "retries >= 3" }
```

### 12.3 工具调用 + 分叉回归

```yaml
bindings:
  reviewer: "maestro delegate --role review"

nodes:
  work:
    actions:
      - id: code
        prompt: 实现功能
      - id: review                     # 分叉到 reviewer
        run: "reviewer"
        prompt: ./prompts/review.md
        output: [review_result]
      - id: adjust                     # 回到主干
        prompt: 根据 {{review_result}} 调整
```

### 12.4 平台切换

```yaml
# 只改 bindings，图完全不变
bindings:
  analyzer: "aider /architect"         # aider
  # analyzer: "maestro delegate --role analyze"  # maestro
  # analyzer: "./scripts/call-claude-api.sh"     # API wrapper
```

### 12.5 Agent 决策工具

```yaml
nodes:
  gate:
    actions:
      - id: evaluate
        run: "reviewer"
        prompt: ./prompts/quality-gate.md
        tools:
          - name: verdict
            schema:
              type: object
              required: [pass]
              properties:
                pass: { type: boolean }
                gaps: { type: array, items: { type: string } }
        output: [verdict]

edges:
  - { from: gate, to: done, when: "verdict.pass" }
  - { from: gate, to: fix,  when: "!verdict.pass" }
```

---

### 12.6 嵌套 + 交接

```yaml
schema: ges/1.0
meta:
  name: build-and-deploy
  entry: build
  terminal: [done]
  input:
    type: object
    required: [repo_path]
    properties:
      repo_path: { type: string }

nodes:
  build:
    actions:
      - id: compile
        run: "npm run build"
        output: [build_output]
      - id: test_sub                    # 嵌套：调用子图，返回后继续
        run: ./test-suite.ges.yaml
        prompt: "{{build_output}}"
        output: [test_result]

edges:
  - from: build
    to: done
    handoff:                            # 交接：结束后转移到 deploy
      target: ./deploy.ges.yaml
      map:
        artifact_path: "{{build_output}}"
        test_passed: "{{test_result.pass}}"
```

---

## 13. 核心/扩展分层

| | Core（v1.0 必学） | Extended（按需引入） |
|---|---|---|
| **Meta** | `name`, `entry`, `terminal` | `description`, `input` |
| **Bindings** | `key: "command string"` | — |
| **Node** | `actions` | `description`, `persist` |
| **Action** | `id`, `prompt`, `run`, `output`, `verify` | `loop`, `optional`, `retry`, `timeout`, `tools` |
| **Edge** | `from`, `to`, `when` | `label`, `handoff` |
| **State** | `current_node`, `variables`, `call_stack` | `handoff` |
| **Skill 间** | — | 嵌套（`run: *.ges.yaml`）、交接（`edge.handoff`） |

**Core 概念数**：3（node, edge, action）
**Core 关键字数**：~12
**5 分钟能写出第一个 GES**：是

---

## 14. 未来扩展预留（v1.1+）

| 功能 | 描述 | 为何推迟 |
|------|------|---------|
| `prompt_layers` | KG 图上下文自动注入 | 需要 KG 引擎集成，新手不需要 |
| `fan_out` / `join` | 并行分叉与汇聚 | 4 种策略过于复杂 |
| `dispatch` | action 内条件分派 | 用 edges 分支 + 多节点替代 |
| `goals` | 独立的目标追踪系统 | verify 已足够 |
| structured bindings | `type: api/sdk/agent` | wrapper 脚本已能覆盖 |

---

## 15. 格式选择记录

**YAML** 作为图定义格式（`when: "a && b"` 零转义，`#` 注释，`|` 多行，`&`/`*` anchor）。
**XML** 保留于 SKILL.md 标签和运行时 prompt 注入。
**JSON** 仅用于 session.json / evidence.ndjson。
