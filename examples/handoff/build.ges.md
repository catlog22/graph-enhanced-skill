---
schema: ges/2.0
name: build
output:
  - artifact_path
  - test_passed
  - version
---

# Build Skill

<graph>
<node id="compile" entry>
  <action id="build" output="artifact_path" />
  <action id="test" output="test_passed" />
  <action id="tag" output="version" />
</node>
<node id="done" terminal />

<edge from="compile" to="done" handoff="./deploy.ges.md" />
</graph>

## [compile.build]

编译项目

## [compile.test]

运行测试

## [compile.tag]

生成版本号
