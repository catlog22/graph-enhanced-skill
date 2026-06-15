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

## 7. 运行时状态（graph-state.yaml）

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
```

**只有 5 个字段**。历史记录交给 `evidence.ndjson`，不膨胀状态文件。

### 7.1 嵌套 skill_call 的状态隔离

```yaml
# 父 skill
- id: deep_analyze
  run: odyssey-planex               # 调用另一个 GES skill
  prompt: "{{sub_requirement}}"
  output: [planex_result]
```

子 skill 生成独立状态文件 `graph-state.odyssey-planex.yaml`，variables 互不污染。完成后仅 output 声明的变量冒泡到父。

---

## 8. 执行器协议

```
LOAD skill.ges.yaml
EXPAND bindings（别名 → 完整命令）
INIT graph-state.yaml { current_node: meta.entry }

LOOP:
  node = nodes[current_node]

  for action in node.actions (from current_action):

    if action.run && action.prompt:
      # 工具 + prompt：命令执行，prompt 作为输入
      cmd = expand(action.run)
      input = load_prompt(action.prompt)
      result = exec(cmd, stdin=input)

    elif action.run:
      # 纯工具
      result = exec(expand(action.run))

    elif action.prompt:
      # 纯 LLM
      instruction = load_prompt(action.prompt)
      result = llm_execute(instruction + context)

    # loop 展开
    if action.loop:
      for item in evaluate(action.loop.over):
        execute_action_with(item as action.loop.as)

    # 输出捕获
    if action.output:
      for key in action.output:
        variables[key] = extract(result, key)

    # 验证
    if action.verify:
      if verify is string → llm_judge(verify, context) → bool
      if verify.run → exec(verify.run) → exit_code == 0

    mark action done → PERSIST graph-state.yaml

  # 转移
  for edge in edges where from == current_node:
    if !edge.when || llm_judge(edge.when, context):
      current_node = edge.to
      break
  else → ERROR: STUCK

  if current_node in meta.terminal → END
```

### 8.1 持久化

遵循 Protected Data Store 模式：`lock → backup → write temp → rename → unlock`。每个 action 完成后持久化，支持断点恢复。

---

## 9. 与 SKILL.md 的共存

| 场景 | 行为 |
|------|------|
| 有 `.ges.yaml` + 执行器支持 | 按图执行，SKILL.md 作为完整参考 |
| 有 `.ges.yaml` + 无执行器 | LLM 读 SKILL.md（现有行为） |
| 无 `.ges.yaml` | 纯现有行为 |

---

## 10. 从 SKILL.md 迁移

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

## 11. 示例

### 11.1 最小 GES

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

### 11.2 带循环

```yaml
edges:
  - { from: do,    to: check }
  - { from: check, to: end,  when: "quality_ok" }
  - { from: check, to: do,   when: "!quality_ok && retries < 3" }
  - { from: check, to: end,  when: "retries >= 3" }
```

### 11.3 工具调用 + 分叉回归

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

### 11.4 平台切换

```yaml
# 只改 bindings，图完全不变
bindings:
  analyzer: "aider /architect"         # aider
  # analyzer: "maestro delegate --role analyze"  # maestro
  # analyzer: "./scripts/call-claude-api.sh"     # API wrapper
```

### 11.5 Agent 决策工具

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

## 12. 核心/扩展分层

| | Core（v1.0 必学） | Extended（按需引入） |
|---|---|---|
| **Meta** | `name`, `entry`, `terminal` | `description` |
| **Bindings** | `key: "command string"` | — |
| **Node** | `actions` | `description`, `persist` |
| **Action** | `id`, `prompt`, `run`, `output`, `verify` | `loop`, `optional`, `retry`, `timeout`, `tools` |
| **Edge** | `from`, `to`, `when` | `label` |
| **State** | `current_node`, `variables`, `call_stack` | — |

**Core 概念数**：3（node, edge, action）
**Core 关键字数**：~12
**5 分钟能写出第一个 GES**：是

---

## 13. 未来扩展预留（v1.1+）

| 功能 | 描述 | 为何推迟 |
|------|------|---------|
| `prompt_layers` | KG 图上下文自动注入 | 需要 KG 引擎集成，新手不需要 |
| `fan_out` / `join` | 并行分叉与汇聚 | 4 种策略过于复杂 |
| `dispatch` | action 内条件分派 | 用 edges 分支 + 多节点替代 |
| `goals` | 独立的目标追踪系统 | verify 已足够 |
| structured bindings | `type: api/sdk/agent` | wrapper 脚本已能覆盖 |

---

## 14. 格式选择记录

**YAML** 作为图定义格式（`when: "a && b"` 零转义，`#` 注释，`|` 多行，`&`/`*` anchor）。
**XML** 保留于 SKILL.md 标签和运行时 prompt 注入。
**JSON** 仅用于 session.json / evidence.ndjson。
