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
<edge from="review" to="fix" when="!review_result.pass && retries < 3" />
<edge from="review" to="end" when="retries >= 3" />
<edge from="fix" to="review" />
</graph>

## [implement]

按需求实现代码变更

## [review]

审查代码变更，检查正确性和风格

## [fix]

修复以下问题：
{{review_result.issues}}

请针对审查意见逐项修复。
