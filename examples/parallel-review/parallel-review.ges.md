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
