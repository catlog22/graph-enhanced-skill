# Phase 3: Action & Prompt Design

Design actions for each node, define bindings, and create external prompt files.

## Objective

- Fill node actions (id, prompt/run, output, verify)
- Define bindings section for tool aliases
- Determine which prompts need external files
- Create prompt file templates
- Produce complete YAML structure ready for generation

## Step 3.1: Bindings Definition

从 gesConfig.tools 生成 bindings：

```yaml
bindings:
  {{tool.alias}}: "{{tool.command}}"
```

**Rules**：
- 每个外部工具一个 binding
- 别名用短名（reviewer, analyzer, searcher）
- 值是完整命令字符串
- 平台切换只改 bindings，图不变

**常见 binding 模板**：

| 用途 | 别名 | 值示例 |
|------|------|--------|
| 代码分析 | `analyzer` | `maestro delegate --role analyze --mode analysis` |
| 代码审查 | `reviewer` | `maestro delegate --role review --mode analysis` |
| 知识搜索 | `searcher` | `maestro search --json` |
| 测试运行 | `tester` | `npm test` |
| 构建 | `builder` | `npm run build` |

## Step 3.2: Action Design per Node

对每个节点设计 actions。每个 action 必须有 `prompt` 或 `run`（或两者）。

### Action 设计决策树

```
这个步骤做什么？
├─ LLM 思考/分析/生成 → prompt only
├─ 运行外部命令 → run only
├─ LLM 指导 + 工具执行 → run + prompt
└─ LLM 执行 + 命令验证 → prompt + verify.run
```

### 每个 Action 的设计清单

1. **id** — 节点内唯一，短名（code, check, parse, fix）
2. **prompt / run** — 至少一个
3. **output** — 这个 action 产出什么变量？后续会引用吗？
4. **verify** — 需要验证吗？用 LLM 判断还是命令验证？
5. **optional** — 失败是否阻塞？
6. **loop** — 是否需要遍历列表？

### Prompt 内联 vs 外部文件

| 条件 | 选择 |
|------|------|
| ≤ 3 行 | 内联 `prompt: "..."` |
| > 3 行 | 外部 `prompt: ./prompts/{node}-{action}.md` |
| 有 `{{var}}` 模板 | 均可，模板引擎自动替换 |
| 复杂指令 + 约束 | 外部文件更清晰 |

## Step 3.3: Variable Flow Mapping

追踪变量在 action 之间的流动：

```
action A (output: [x]) → action B (prompt: "用 {{x}} 做 Y")
                        → edge (when: "x.pass")
```

**验证**：
- 每个 `{{var}}` 引用必须有前置 action 的 `output` 定义
- edge `when` 中的变量必须在前置节点中产出
- 没有悬空引用

## Step 3.4: Decision Tools（可选）

当 `run` 执行的是 Agent 需要结构化返回时：

```yaml
tools:
  - name: verdict
    schema:
      type: object
      required: [pass]
      properties:
        pass: { type: boolean }
        issues: { type: array, items: { type: string } }
```

**何时使用**：run 指向 binding（Agent 工具），且需要解析结构化结果供 edge 判断。

## Step 3.5: Prompt File Templates

为每个外部 prompt 生成模板：

```markdown
# {Node}.{Action} Prompt

## Context
- Variables: {{var1}}, {{var2}}
- Current state: {node description}

## Instructions
{specific instructions for this action}

## Expected Output
{what the LLM should produce}
```

## Step 3.6: Assembly Review

将完整 YAML 结构展示给用户审核：

```yaml
schema: ges/1.0
meta: { name: ..., entry: ..., terminal: [...] }
bindings: { ... }
nodes:
  node1:
    actions:
      - id: ...
        prompt: ...
        output: [...]
  ...
edges:
  - { from: ..., to: ..., when: "..." }
  ...
```

## Output

- **Variable**: `fullGraph` (complete YAML structure + prompt file contents)
- User-reviewed complete graph

## Next Phase

→ [Phase 4: Generate & Validate](04-generate.md)
