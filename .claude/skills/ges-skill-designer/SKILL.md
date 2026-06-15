---
name: ges-skill-designer
description: Meta-skill for designing GES (Graph-Enhanced Skill) YAML definitions. Creates .ges.yaml graph files with nodes, edges, actions, bindings, and prompt files. Triggers on "design ges", "create ges skill", "ges designer".
allowed-tools: Agent, AskUserQuestion, Read, Write, Edit, Bash, Glob, Grep
---

# GES Skill Designer

Meta-skill for creating `.ges.yaml` graph definitions following the GES v1.0 standard. Generates complete skill packages: graph YAML, external prompt files, and optional bindings configuration.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  GES Skill Designer                                             │
│  → Analyze requirements → Design graph → Generate artifacts     │
└───────────────┬─────────────────────────────────────────────────┘
                │
    ┌───────────┼───────────┬───────────┐
    ↓           ↓           ↓           ↓
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ Phase 1 │ │ Phase 2 │ │ Phase 3 │ │ Phase 4 │
│ Require │ │  Graph  │ │ Actions │ │Generate │
│ Analysis│ │ Design  │ │ Design  │ │& Valid  │
└─────────┘ └─────────┘ └─────────┘ └─────────┘
     ↓           ↓           ↓           ↓
  gesConfig   node/edge   actions +   .ges.yaml
  object      topology    prompts     + prompts/
```

## Target Output Structure

```
{target-dir}/
├── {name}.ges.yaml            # GES graph definition
└── prompts/                   # External prompt files (if needed)
    ├── {node}-{action}.md
    └── ...
```

## GES v1.0 Quick Reference

三个核心概念：

| 概念 | 说明 | YAML |
|------|------|------|
| **节点 (node)** | 状态，包含有序 actions | `nodes.{name}.actions: [...]` |
| **边 (edge)** | 转移，when 条件决定走哪条 | `edges: [{from, to, when}]` |
| **动作 (action)** | prompt（LLM）或 run（工具） | `{id, prompt?, run?, output?, verify?}` |

Action 四种模式：

| 模式 | 字段 | 语义 |
|------|------|------|
| 纯 LLM | `prompt` | LLM 执行指令 |
| 纯工具 | `run` | 命令/工具执行 |
| 工具+prompt | `run` + `prompt` | 工具执行，prompt 作为输入 |
| LLM+验证 | `prompt` + `verify.run` | LLM 执行，命令验证结果 |

## Execution Flow

```
Phase 1: Requirements Analysis
   └─ Ref: phases/01-requirements.md
      ├─ Input: user description / existing SKILL.md / requirements
      └─ Output: gesConfig (name, states, transitions, tools)

Phase 2: Graph Topology Design
   └─ Ref: phases/02-graph-design.md
      ├─ Input: gesConfig
      └─ Output: graphTopology (nodes, edges, entry, terminal)

Phase 3: Action & Prompt Design
   └─ Ref: phases/03-action-design.md
      ├─ Input: graphTopology + gesConfig
      └─ Output: fullGraph (actions, bindings, prompts)

Phase 4: Generate & Validate
   └─ Ref: phases/04-generate.md
      ├─ Input: fullGraph
      └─ Output: .ges.yaml + prompts/*.md (validated)
```

**Phase Reference Documents** (read on-demand):

| Phase | Document | Purpose |
|-------|----------|---------|
| 1 | [phases/01-requirements.md](phases/01-requirements.md) | Gather and analyze workflow requirements |
| 2 | [phases/02-graph-design.md](phases/02-graph-design.md) | Design node/edge topology |
| 3 | [phases/03-action-design.md](phases/03-action-design.md) | Design actions, bindings, prompts |
| 4 | [phases/04-generate.md](phases/04-generate.md) | Generate files and validate |

## Input Sources

| Source | Description | Example |
|--------|-------------|---------|
| **Text description** | Natural language workflow | "审查循环：实现→审查→修复" |
| **Existing SKILL.md** | Convert state machine to GES | `.claude/commands/odyssey-planex.md` |
| **State list** | Enumerated states + transitions | "states: intake, plan, execute, verify" |

## Core Rules

1. **GES v1.0 only** — use only core/extended fields from the spec
2. **Bindings for tools** — all external tool references go through bindings
3. **External prompts for long text** — inline prompt > 3 lines → extract to `./prompts/{name}.md`
4. **Edges order matters** — first match wins; put specific conditions before default
5. **Terminal nodes are implicit** — don't define them in `nodes`, only in `meta.terminal`
6. **Action requires prompt or run** — every action must have at least one

## Data Flow

```
User Input (description or SKILL.md path)
    ↓
Phase 1: Requirements Analysis
    ↓ Output: gesConfig
Phase 2: Graph Topology Design
    ↓ Output: graphTopology (nodes + edges as diagram)
Phase 3: Action & Prompt Design
    ↓ Output: fullGraph (complete YAML structure)
Phase 4: Generate & Validate
    ↓ Output: .ges.yaml file + prompt files
```

## Error Handling

- **Missing states** — ask user to clarify workflow stages
- **Disconnected nodes** — every non-terminal node must have outgoing edge
- **No entry path** — meta.entry must be a defined node
- **Validation failure** — fix and re-validate before completion
