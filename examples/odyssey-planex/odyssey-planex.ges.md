---
schema: ges/2.0
name: odyssey-planex
bindings:
  analyzer: "maestro delegate --role analyze --mode analysis"
  reviewer: "maestro delegate --role review --mode analysis"
  searcher: "maestro search --json"
---

# Odyssey Planex — 需求驱动迭代闭环

<graph>
<node id="intake" entry>
  <action id="parse" />
  <action id="define_criteria" output="acceptance_criteria" verify="acceptance_criteria.length >= 1" />
  <action id="search_prior" run="searcher '{{keywords}}'" output="prior_knowledge" optional="true" />
</node>

<node id="plan">
  <action id="cli_assist" run="analyzer" output="plan_suggestion" />
  <action id="finalize" />
</node>

<node id="execute">
  <action id="implement" loop="over:{{plan.tasks}},as:task" />
</node>

<node id="verify">
  <action id="check" loop="over:{{acceptance_criteria}},as:criterion" />
  <action id="summarize" />
</node>

<node id="fix">
  <action id="targeted_fix" loop="over:{{failed_criteria}},as:criterion" />
  <action id="review" run="reviewer" output="fix_verdict" />
</node>

<node id="generalize">
  <action id="extract" />
  <action id="scan" run="analyzer" output="scan_results" />
</node>

<node id="record">
  <action id="summarize" />
  <action id="completion" />
</node>

<node id="end" terminal />

<edge from="intake" to="intake" when="no_requirement" />
<edge from="intake" to="plan" when="criteria_defined" />
<edge from="plan" to="execute" />
<edge from="execute" to="verify" />
<edge from="verify" to="end" when="all_passed && skip_generalize" />
<edge from="verify" to="generalize" when="all_passed" />
<edge from="verify" to="fix" when="some_failed && iteration < max" />
<edge from="verify" to="record" when="some_failed && iteration >= max" />
<edge from="fix" to="verify" />
<edge from="generalize" to="record" />
<edge from="record" to="end" />
</graph>

## [intake.parse]

解析 $ARGUMENTS，生成 slug，创建 SESSION_DIR

## [intake.define_criteria]

分析以下需求并推导验收标准：

**需求**：{{requirement}}

**已有知识**：
{{prior_knowledge}}

为每个标准指定验证方式（test / grep / cli-review / manual），
确保标准是客观可测的，避免主观表述。

**输出格式**：
```json
[
  { "id": "AC1", "criterion": "...", "verify_method": "test|grep|cli-review|manual" }
]
```

## [intake.search_prior]

搜索与需求相关的历史知识

## [plan.cli_assist]

PURPOSE: 为以下需求创建实现计划
TASK: 分解子任务 | 映射验收标准 | 识别依赖关系
CONTEXT: @**/* | Criteria: {{acceptance_criteria}}
EXPECTED: JSON [{task_id, title, description, criteria_refs, deps}]

## [plan.finalize]

整合 {{plan_suggestion}}，生成执行计划

## [execute.implement]

按计划实现代码变更

## [verify.check]

验证以下验收标准：

**标准**：{{criterion.criterion}}
**验证方式**：{{criterion.verify_method}}

根据验证方式执行检查，返回 pass/fail 结果及证据。

## [verify.summarize]

汇总 pass/fail 表

## [fix.targeted_fix]

对每个 failed criterion 诊断并修复

## [fix.review]

PURPOSE: 检查修复的正确性和无回归
TASK: 验证修复是否解决了失败的标准 | 检查是否引入新问题
CONTEXT: @{{modified_files}} | Passing: {{passing_criteria}} | Fixed: {{fixed_criteria}}
EXPECTED: JSON {verdict: "pass"|"fail", regression_risk: "low"|"medium"|"high", concerns: []}

## [generalize.extract]

从实现中提取可复用模式（syntax/semantic/structural）

## [generalize.scan]

扫描全项目，查找与提取模式相似的代码

## [record.summarize]

总结迭代过程，输出建议的知识持久化命令

## [record.completion]

输出 completion summary
