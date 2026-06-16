---
schema: ges/2.0
name: hello
---

# Hello

<graph>
<node id="start" entry />
<node id="respond" />
<node id="end" terminal />

<edge from="start" to="respond" />
<edge from="respond" to="end" />
</graph>

## [start]

向用户打招呼并询问需求

## [respond]

根据用户需求给出回答
