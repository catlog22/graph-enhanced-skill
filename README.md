# GES — Graph-Enhanced Skill Standard

将 AI Agent Skill 内部的状态机从散文描述提升为 YAML 图结构，确保每个步骤准确执行。

## Quick Start

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

## Core Concepts

| 概念 | 含义 |
|------|------|
| **node** | 状态——包含有序 actions |
| **edge** | 转移——when 条件决定走哪条 |
| **action** | `prompt`（LLM 做）或 `run`（工具做） |

## Action Modes

```yaml
# LLM 执行
- prompt: 分析需求

# 工具执行
- run: "npm test"

# 工具 + prompt（工具执行，prompt 作为输入）
- run: "analyzer"
  prompt: ./prompts/plan.md

# LLM + 命令验证
- prompt: 实现功能
  verify: { run: "npm test" }
```

## Bindings — Platform Abstraction

```yaml
bindings:
  analyzer: "maestro delegate --role analyze"
  # analyzer: "aider /architect"          # switch platform
  # analyzer: "./scripts/call-api.sh"     # API wrapper
```

## Documentation

- [SPEC.md](SPEC.md) — Complete specification
- [examples/](examples/) — Example GES files

## License

MIT
