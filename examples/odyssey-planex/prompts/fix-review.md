PURPOSE: 检查修复的正确性和无回归
TASK: 验证修复是否解决了失败的标准 | 检查是否引入新问题
CONTEXT: @{{modified_files}} | Passing: {{passing_criteria}} | Fixed: {{fixed_criteria}}
EXPECTED: JSON {verdict: "pass"|"fail", regression_risk: "low"|"medium"|"high", concerns: []}
