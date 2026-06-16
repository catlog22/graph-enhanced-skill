---
schema: ges/2.0
name: deploy
input:
  type: object
  required:
    - artifact_path
  properties:
    artifact_path:
      type: string
      description: 构建产物路径
    test_passed:
      type: string
      description: 测试结果
    version:
      type: string
      description: 版本号
---

# Deploy Skill

<graph>
<node id="prepare" entry>
  <action id="check" />
  <action id="deploy" output="deploy_result" />
</node>
<node id="done" terminal />

<edge from="prepare" to="done" />
</graph>

## [prepare.check]

验证部署条件: artifact={{artifact_path}} test={{test_passed}}

## [prepare.deploy]

部署版本 {{version}} 到生产环境
