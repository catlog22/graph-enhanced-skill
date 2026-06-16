---
schema: ges/2.0
name: parent-skill
---

# Parent Skill

<graph>
<node id="prepare" entry />
<node id="delegate" run="./child.ges.md" output="child_result" />
<node id="summarize" />
<node id="end" terminal />

<edge from="prepare" to="delegate" />
<edge from="delegate" to="summarize" />
<edge from="summarize" to="end" />
</graph>

## [prepare]

准备任务数据

## [delegate]

需要子图处理的数据

## [summarize]

汇总子图结果: {{child_result}}
