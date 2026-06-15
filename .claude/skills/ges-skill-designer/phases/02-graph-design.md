# Phase 2: Graph Topology Design

Design the node/edge topology from gesConfig. Focus on graph structure, not action content.

## Objective

- Define `meta` section (name, entry, terminal)
- Map states to nodes (just names, no actions yet)
- Design edge topology with conditions
- Verify: no orphan nodes, all non-terminal nodes have outgoing edges
- Produce ASCII + Mermaid visualization for user review

## Step 2.1: Meta Section

```yaml
schema: ges/1.0
meta:
  name: {{gesConfig.name}}
  entry: {{gesConfig.entry}}
  terminal: {{gesConfig.terminal}}
```

**Rules**:
- Terminal nodes are implicit — they appear in `meta.terminal` but NOT in `nodes`
- Entry must reference a defined node
- At least one terminal required

## Step 2.2: Node Skeleton

For each state in gesConfig, create a node placeholder:

```yaml
nodes:
  {{state.name}}:
    actions: []  # filled in Phase 3
```

## Step 2.3: Edge Design

Convert transitions to edges. **Order matters** — first match wins.

**Design rules**:
1. Specific conditions before general/default edges
2. Loop-back edges (fix → review) need clear termination conditions
3. Every non-terminal node must have at least one outgoing edge
4. Unconditional edge = omit `when` field (not `when: "true"`)

```yaml
edges:
  # 具体条件先
  - { from: review, to: end,  when: "review_result.pass" }
  - { from: review, to: fix,  when: "!review_result.pass && retries < 3" }
  # 兜底条件
  - { from: review, to: end,  when: "retries >= 3" }
  # 无条件
  - { from: implement, to: review }
  - { from: fix, to: review }
```

**Loop detection**：如果 gesConfig.features.hasLoop，确保循环有终止条件：
- 迭代计数器 (`iteration < max`)
- 质量通过 (`quality_ok`)
- 超时保护 (`elapsed < timeout`)

## Step 2.4: Topology Visualization

生成两种可视化供用户审核：

### ASCII Diagram

```
[implement] ──→ [review] ──→ [end]
                  │    ↑
                  ↓    │
                [fix] ─┘
```

### Mermaid Diagram

```mermaid
graph TD
  implement --> review
  review -->|pass| end
  review -->|!pass & retries<3| fix
  review -->|retries>=3| end
  fix --> review
```

## Step 2.5: Topology Validation

检查清单：
- [ ] 每个非终态节点都有出边
- [ ] entry 节点存在于 nodes 中
- [ ] terminal 节点不在 nodes 中定义
- [ ] 无孤立节点（不可达）
- [ ] 循环有终止条件
- [ ] 边条件互斥或有明确优先级

向用户展示拓扑图并确认后交付 Phase 3。

## Output

- **Variable**: `graphTopology` (meta + nodes skeleton + edges)
- Topology diagram reviewed by user

## Next Phase

→ [Phase 3: Action & Prompt Design](03-action-design.md)
