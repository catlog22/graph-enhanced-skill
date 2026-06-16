# GES v2.0 — Markdown-Native Graph-Enhanced Skill

> 一个 `.ges.md` 文件 = 完整的可执行 skill（图拓扑 + prompt 内容）。
> `<graph>` 管机器读，`## [id]` 管人读。

---

## 1. 文件结构

```
---                              ← YAML frontmatter（全局配置）
schema: ges/2.0
name: <name>
goal: <expression>               ← 可选
bindings:
  <alias>: <command>
---

# <Title>                       ← 文档标题（人类可读，解析器忽略）

<graph>                          ← 状态区：完整执行蓝图
<node ... />
<edge ... />
<join ... />
</graph>

## [<action-ref>]               ← 内容区：纯 prompt
Markdown prompt content...

## [<action-ref>]
...
```

扩展名：`.ges.md`

---

## 2. Frontmatter

只放全局配置，不放图拓扑：

```yaml
---
schema: ges/2.0
name: review-loop
goal: "all_pass"
bindings:
  reviewer: "maestro delegate --role review --mode analysis"
  analyzer: "maestro delegate --role analyze --mode analysis"
---
```

| 字段 | 必需 | 说明 |
|------|------|------|
| `schema` | 是 | `ges/2.0` |
| `name` | 是 | 图名称，`[a-z][a-z0-9-]*` |
| `goal` | 否 | 全局目标表达式，注入 edge when 上下文为 `goal` 变量 |
| `bindings` | 否 | 工具别名映射 |

---

## 3. Graph 区 — 执行蓝图

`<graph>` 是唯一的机器语义源。所有 node、action 配置、edge、join 只写在这里。

### 3.1 Node

```html
<!-- 1:1 简写：单 action 节点，配置直接写在 node 上 -->
<node id="lint" run="npm run lint -- --json" output="lint" />

<!-- 多 action 节点 -->
<node id="intake" entry>
  <action id="parse" output="task" />
  <action id="define_criteria" output="acceptance_criteria" verify="acceptance_criteria.length >= 1" />
  <action id="search_prior" run="searcher '{{keywords}}'" output="prior_knowledge" optional="true" />
</node>

<!-- 终态节点 -->
<node id="end" terminal />
```

**`<node>` 属性：**

| 属性 | 说明 |
|------|------|
| `id` | 必需。节点标识 |
| `entry` | 入口节点标记（整个图有且只有一个） |
| `terminal` | 终态节点标记（可多个） |
| `run` | 1:1 简写时的命令（等价于内嵌单个 `<action>` 的 `run`） |
| `output` | 1:1 简写时的输出变量 |
| `verify` | 1:1 简写时的验证表达式 |
| `loop` | 1:1 简写时的循环（格式 `over:expr,as:var`） |
| `optional` | 1:1 简写时是否可选 |

**1:1 简写规则**：`<node id="X" run="..." />` 等价于 `<node id="X"><action id="X" run="..." /></node>`。简写时 action id 隐式等于 node id。

### 3.2 Action（嵌套在 Node 内）

```html
<action id="check" run="reviewer" output="review_result" />
```

| 属性 | 说明 |
|------|------|
| `id` | 必需。节点内唯一 |
| `run` | 工具命令（引用 binding 或直接命令） |
| `output` | 输出变量名（逗号分隔多个） |
| `verify` | 验证表达式 |
| `loop` | 循环（格式 `over:expr,as:var`） |
| `optional` | `"true"` 时失败不阻塞 |
| `retry` | 重试次数 |
| `timeout` | 超时毫秒 |

### 3.3 Edge

```html
<edge from="implement" to="review" />
<edge from="decide" to="end" when="goal" />
<edge from="decide" to="fix" when="!goal && iteration < 3" />

<!-- fork：逗号分隔多目标 -->
<edge from="intake" to="lint, tests, review" />

<!-- 修复后重新 fork -->
<edge from="fix" to="lint, tests, review" />
```

| 属性 | 说明 |
|------|------|
| `from` | 必需。源节点 |
| `to` | 必需。目标节点（逗号分隔 = fork） |
| `when` | 条件表达式（空 = 无条件） |

### 3.4 Join

```html
<join from="lint, tests, review" to="decide" />
```

| 属性 | 说明 |
|------|------|
| `from` | 必需。等待的源节点（逗号分隔） |
| `to` | 必需。汇聚目标节点 |

**求值规则**：所有 `from` 节点的 `active` 状态为 `__done__` 后，join 才触发转移到 `to`。

---

## 4. 内容区 — Prompt

`<graph>` 之后的 `## [ref]` heading 定义 prompt 内容。

```markdown
## [intake.parse]

解析 $ARGUMENTS，生成 slug，创建 SESSION_DIR

## [lint]

执行静态代码分析

## [decide]

汇总结果：
- lint: {{lint}}
- tests: {{tests}}
- review: {{review}}
```

**引用规则**：
- `## [node_id]` — 引用 1:1 简写节点的隐式 action
- `## [node_id.action_id]` — 引用多 action 节点中的指定 action
- `## [id]` 到下一个 `## [id]` 之间的 Markdown 原文 = `action.prompt`
- prompt 支持完整 Markdown：列表、代码块、粗体、表格等
- prompt 内可使用 `{{variable}}` 模板变量
- 无 prompt 的 action（纯 run）可以没有对应的 `## [id]`

**硬规则**：
1. `## [id]` 中不放任何配置属性——纯自然语言
2. 配置只在 `<graph>` 中定义
3. `## [id]` 的 `id` 必须匹配 graph 中已声明的 action

---

## 5. 解析协议

```
Pass 1 — 构建 GesGraph：
  1. 读取 YAML frontmatter → schema, name, goal, bindings
  2. 提取 <graph>...</graph> 块
  3. 解析 graph 内的 <node>, <action>, <edge>, <join> 标签
  4. 1:1 简写展开：<node id="X" run="..."/> → node.actions = [{ id: "X", run: "..." }]
  5. 构建 GesGraph = { schema, meta: { name, entry, terminal, goal }, bindings, nodes, edges }
  6. 验证：entry 唯一、terminal 存在、edge 引用节点有效、action id 唯一

Pass 2 — 注入 Prompt：
  7. 扫描 ## [...] heading
  8. 提取 heading 到下一个 heading 之间的 Markdown 原文
  9. 按 ref 匹配到 GesGraph.nodes[nodeId].actions[actionId].prompt
  10. 未匹配的 ref 报错；无 prompt 的 run-only action 允许缺省
```

---

## 6. 完整示例

### 6.1 简单图：review-loop.ges.md

```markdown
---
schema: ges/2.0
name: review-loop
bindings:
  reviewer: "maestro delegate --role review --mode analysis"
---

# Review Loop

<graph>
<node id="implement" entry />
<node id="review" run="reviewer" output="review_result" />
<node id="fix" />
<node id="end" terminal />

<edge from="implement" to="review" />
<edge from="review" to="end" when="review_result.pass" />
<edge from="review" to="fix" when="!review_result.pass" />
<edge from="fix" to="review" />
</graph>

## [implement]

按需求实现代码变更

## [review]

审查代码变更：
- 检查代码风格是否符合规范
- 检查是否引入安全漏洞

## [fix]

修复问题：{{review_result.issues}}
请针对审查意见逐项修复。
```

### 6.2 并行图：parallel-review.ges.md

```markdown
---
schema: ges/2.0
name: parallel-review
goal: "lint.pass && tests.pass && review.pass"
bindings:
  reviewer: "maestro delegate --role review --mode analysis"
---

# Parallel Code Review

<graph>
<node id="intake" entry output="task" />
<node id="lint" run="npm run lint -- --json" output="lint" />
<node id="tests" run="npm test -- --json" output="tests" />
<node id="review" run="reviewer" output="review" />
<node id="decide" />
<node id="fix" />
<node id="end" terminal />

<edge from="intake" to="lint, tests, review" />
<join from="lint, tests, review" to="decide" />
<edge from="decide" to="end" when="goal" />
<edge from="decide" to="fix" when="!goal && iteration < 3" />
<edge from="decide" to="end" when="iteration >= 3" />
<edge from="fix" to="lint, tests, review" />
</graph>

## [intake]

解析需求，确定待审查范围

## [lint]

执行静态代码分析

## [tests]

执行单元测试

## [review]

审查 {{task}} 的代码质量

## [decide]

汇总结果：
- lint: {{lint}}
- tests: {{tests}}
- review: {{review}}

## [fix]

修复未通过的检查项
```

### 6.3 多 Action 节点：intake 示例

```markdown
<graph>
<node id="intake" entry>
  <action id="parse" output="task" />
  <action id="define_criteria" output="acceptance_criteria" verify="acceptance_criteria.length >= 1" />
  <action id="search_prior" run="searcher '{{keywords}}'" output="prior_knowledge" optional="true" />
</node>
</graph>

## [intake.parse]

解析 $ARGUMENTS，生成 slug，创建 SESSION_DIR

## [intake.define_criteria]

分析以下需求并推导验收标准：

**需求**：{{requirement}}

为每个标准指定验证方式（test / grep / cli-review / manual），
确保标准是客观可测的。

**输出格式**：
```json
[{ "id": "AC1", "criterion": "...", "verify_method": "test" }]
```
```

---

## 7. 唯一格式

v2.0 `.ges.md` 是 GES 的唯一格式。v1.1 YAML 格式已废弃并完全移除。

---

## 8. 标签速查

```
<graph>                                    容器，包含所有拓扑标签
  <node id entry terminal                  节点
        run output verify loop optional>   1:1 简写属性
    <action id run output verify           嵌套 action（多 action 时）
            loop optional retry timeout />
  </node>
  <edge from to when />                    转移（to 逗号分隔 = fork）
  <join from to />                         汇聚（from 逗号分隔 = 等待全部）
</graph>

## [ref]                                   Prompt 内容区
```
