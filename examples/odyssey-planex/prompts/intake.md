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
