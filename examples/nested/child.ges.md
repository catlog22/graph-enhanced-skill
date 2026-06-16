---
schema: ges/2.0
name: child-skill
output:
  - child_result
---

# Child Skill

<graph>
<node id="process" entry output="child_result" />
<node id="done" terminal />

<edge from="process" to="done" />
</graph>

## [process]

分析输入: {{_input}}
