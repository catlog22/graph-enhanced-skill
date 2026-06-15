# Phase 1: Requirements Analysis

Gather and analyze workflow requirements from various sources to build a structured configuration.

## Objective

- Identify all states/phases in the workflow
- Map transitions between states
- Identify external tools needed (→ bindings)
- Detect input source type and extract structure
- Produce `gesConfig` object for subsequent phases

## Step 1.1: Identify Input Source

| Indicator | Type | Action |
|-----------|------|--------|
| Free text describing workflow | `description` | Interactive requirements gathering |
| Path to `.claude/commands/*.md` | `skill_md` | Extract state machine from SKILL.md |
| Enumerated state list | `state_list` | Parse states and transitions directly |

## Step 1.2: Source-Specific Analysis

### Mode A: Text Description

```javascript
const basicInfo = AskUserQuestion({
  questions: [
    {
      question: "GES 技能的名称？（kebab-case）",
      header: "Name",
      multiSelect: false,
      options: [
        { label: "Custom name", description: "输入自定义名称" },
        { label: "Auto-generate", description: "从描述自动生成" }
      ]
    },
    {
      question: "这个工作流包含哪些主要阶段？",
      header: "Stages",
      multiSelect: false,
      options: [
        { label: "Linear (2-3)", description: "简单线性流程" },
        { label: "Loop (3-4)", description: "包含审查/修复循环" },
        { label: "Complex (5+)", description: "多分支+循环" }
      ]
    },
    {
      question: "是否需要外部工具集成？",
      header: "Tools",
      multiSelect: false,
      options: [
        { label: "No tools", description: "纯 LLM 执行" },
        { label: "CLI tools", description: "需要命令行工具（delegate/search 等）" },
        { label: "API tools", description: "需要 API 调用（通过 wrapper）" }
      ]
    }
  ]
})
```

### Mode B: Existing SKILL.md Analysis

从 SKILL.md 提取状态机结构：

```javascript
const content = Read(skillMdPath);

// 提取关键结构
// <states> 标签中的状态 → nodes
// <transitions> 中的转移 → edges
// "spawn agent" / "maestro delegate" → bindings
// A_* 步骤描述 → actions
// phase_goals → verify
// skip_when → edge conditions
```

**SKILL.md 映射规则**：

| SKILL.md 元素 | GES 映射 |
|---------------|---------|
| `<states>` 中的状态 | `nodes` 下的 key |
| `<transitions>` 的转移 | `edges` |
| `A_*` 中的步骤 | `node.actions` |
| `spawn agent` / `maestro delegate` | `bindings` + `run` |
| `phase_goals` | `action.verify` |
| `skip_when` | edge `when` 条件 |
| 长 prompt 段落 | `./prompts/*.md` |

### Mode C: State List

```javascript
// 用户提供：intake, plan, execute, verify, fix, record
// 直接解析为节点列表
const states = parseStateList(userInput);
```

## Step 1.3: Build Configuration

```javascript
const gesConfig = {
  name: "review-loop",
  description: "审查循环工作流",
  targetDir: ".claude/commands/",

  // 状态列表
  states: [
    { name: "implement", description: "实现代码变更", hasLoop: false },
    { name: "review", description: "审查代码质量", hasLoop: false },
    { name: "fix", description: "修复审查问题", hasLoop: false }
  ],

  // 转移关系
  transitions: [
    { from: "implement", to: "review", condition: null },
    { from: "review", to: "end", condition: "review_result.pass" },
    { from: "review", to: "fix", condition: "!review_result.pass && retries < 3" },
    { from: "review", to: "end", condition: "retries >= 3" },
    { from: "fix", to: "review", condition: null }
  ],

  // 外部工具
  tools: [
    { alias: "reviewer", command: "maestro delegate --role review --mode analysis" }
  ],

  // 入口和终态
  entry: "implement",
  terminal: ["end"],

  // 特性标记
  features: {
    hasLoop: true,
    hasExternalTools: true,
    hasDecisionTools: false,
    needsExternalPrompts: false
  }
};
```

## Step 1.4: User Confirmation

展示分析结果：

```
GES 设计概要：
  Name: review-loop
  States: implement → review → fix (loop)
  Entry: implement | Terminal: end
  Tools: reviewer (maestro delegate)
  Features: loop, external tools
```

确认后交付给 Phase 2。

## Output

- **Variable**: `gesConfig`
- Proceed to Phase 2

## Next Phase

→ [Phase 2: Graph Topology Design](02-graph-design.md)
