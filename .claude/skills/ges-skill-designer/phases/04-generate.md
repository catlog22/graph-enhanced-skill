# Phase 4: Generate & Validate

Generate the `.ges.yaml` file and prompt files, then validate the complete package.

## Objective

- Write `.ges.yaml` file with proper YAML formatting
- Generate external prompt `.md` files
- Validate graph structure
- Optionally test with `ges validate` CLI
- Present summary to user

## Step 4.1: Generate .ges.yaml

YAML 格式规范：

```yaml
# {description}
schema: ges/1.0

meta:
  name: {name}
  entry: {entry}
  terminal: [{terminals}]

# ── 工具别名 ──
bindings:
  {alias}: "{command}"

# ── 节点 ──
nodes:
  {node_name}:
    actions:
      - id: {action_id}
        prompt: {prompt_or_path}
        output: [{vars}]

# ── 边 ──
edges:
  - { from: {node}, to: {node}, when: "{condition}" }
```

**格式规则**：
- 顶级 section 用 `# ──` 注释分隔
- meta 用 flow style（单行 `{ }` ）当字段简单
- edges 用 flow style（单行 `{ }` ）保持紧凑
- 多行 prompt 用 `|` block scalar
- bindings 值用引号包裹

## Step 4.2: Generate Prompt Files

目标目录：`{targetDir}/prompts/`

每个外部 prompt 文件的内容根据 Phase 3 中的模板生成。

文件命名：`{node}-{action}.md`（或根据 action 的语义命名）

## Step 4.3: Self-Validation

在写入前进行内部检查：

### 结构检查

- [ ] `schema: ges/1.0` 存在
- [ ] `meta.name`, `meta.entry`, `meta.terminal` 完整
- [ ] `meta.entry` 在 `nodes` 中定义
- [ ] `meta.terminal` 中的节点不在 `nodes` 中定义
- [ ] 每个 node 至少有一个 action
- [ ] 每个 action 有 `id` 且有 `prompt` 或 `run`
- [ ] action id 在节点内唯一

### 连通性检查

- [ ] 每个非终态节点有出边
- [ ] edge 的 `from` 和 `to` 引用有效节点（包括 terminal）
- [ ] 从 entry 可达所有节点
- [ ] 无孤立节点

### 引用检查

- [ ] `{{var}}` 引用的变量在前置路径有 `output` 定义
- [ ] binding 引用在 `bindings` section 有定义
- [ ] 外部 prompt 文件路径存在（生成后）

## Step 4.4: Write Files

```javascript
// Write .ges.yaml
Write(`${targetDir}/${name}.ges.yaml`, yamlContent);

// Write prompt files
for (const [filename, content] of promptFiles) {
  Write(`${targetDir}/prompts/${filename}`, content);
}
```

## Step 4.5: CLI Validation（可选）

如果 `ges` CLI 可用：

```bash
cd ${targetDir}
npx --prefix D:/ges tsx D:/ges/src/cli.ts validate ${name}.ges.yaml
```

## Step 4.6: Visualization

生成 Mermaid 图供确认：

```bash
npx --prefix D:/ges tsx D:/ges/src/cli.ts viz ${name}.ges.yaml
```

## Step 4.7: Summary

```
GES Skill 生成完成：

文件：
  ├── {name}.ges.yaml ({N} nodes, {M} edges, {K} actions)
  └── prompts/ ({P} files)

图结构：
  Entry: {entry} → ... → Terminal: {terminal}

下一步：
  - ges load {name}.ges.yaml    加载并创建 session
  - ges run {name}.ges.yaml     直接运行
  - ges viz {name}.ges.yaml     查看 Mermaid 图
```

## Output

- **Files**: `{name}.ges.yaml` + `prompts/*.md`
- Validated and ready for execution

## Complete

GES Skill 设计完成。
