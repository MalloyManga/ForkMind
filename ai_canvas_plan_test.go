package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestCanvasPlanToolDefinition 验证唯一工具名称和 JSON Schema 可以被 Provider 正常编码
func TestCanvasPlanToolDefinition(t *testing.T) {
	t.Parallel()

	tool := canvasPlanToolDefinition()
	if tool.Type != "function" || tool.Function.Name != canvasPlanToolName {
		t.Fatalf("tool definition = %#v", tool)
	}
	var schema map[string]interface{}
	if err := json.Unmarshal(tool.Function.Parameters, &schema); err != nil {
		t.Fatalf("tool schema JSON error = %v", err)
	}
	if schema["type"] != "object" {
		t.Fatalf("tool schema type = %#v", schema["type"])
	}
}

// TestParseCanvasPlanToolCall 验证合法的多类型节点和内部关系可以进入待审批协议
func TestParseCanvasPlanToolCall(t *testing.T) {
	t.Parallel()

	arguments := `{"nodes":[{"tempId":"root","cardType":"note","content":{"noteContent":"overview"},"parentTempId":null,"referenceTempIds":[]},{"tempId":"site","cardType":"link","content":{"url":"https://example.com","title":"Example","description":"reference"},"parentTempId":"root","referenceTempIds":[]}]}`
	plan, err := parseCanvasPlanToolCall(OpenAIToolCall{Name: canvasPlanToolName, Arguments: arguments})
	if err != nil {
		t.Fatalf("parseCanvasPlanToolCall() error = %v", err)
	}
	if len(plan.Nodes) != 2 || plan.Nodes[1].ParentTempID == nil || *plan.Nodes[1].ParentTempID != "root" {
		t.Fatalf("plan = %#v", plan)
	}
}

// TestParseCanvasPlanToolCallRejectsInvalidPlans 验证模型输出不能绕过字段 关系和 URL 安全边界
func TestParseCanvasPlanToolCallRejectsInvalidPlans(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name          string
		toolName      string
		arguments     string
		errorFragment string
	}{
		{name: "unknown tool", toolName: "create_card", arguments: `{}`, errorFragment: "unsupported tool"},
		{name: "extra content field", toolName: canvasPlanToolName, arguments: `{"nodes":[{"tempId":"one","cardType":"note","content":{"noteContent":"ok","extra":true},"parentTempId":null,"referenceTempIds":[]}]}`, errorFragment: "unknown field"},
		{name: "missing parent", toolName: canvasPlanToolName, arguments: `{"nodes":[{"tempId":"one","cardType":"note","content":{"noteContent":"ok"},"parentTempId":"missing","referenceTempIds":[]}]}`, errorFragment: "does not exist"},
		{name: "parent cycle", toolName: canvasPlanToolName, arguments: `{"nodes":[{"tempId":"one","cardType":"note","content":{"noteContent":"1"},"parentTempId":"two","referenceTempIds":[]},{"tempId":"two","cardType":"note","content":{"noteContent":"2"},"parentTempId":"one","referenceTempIds":[]}]}`, errorFragment: "cycle"},
		{name: "unsafe URL", toolName: canvasPlanToolName, arguments: `{"nodes":[{"tempId":"one","cardType":"link","content":{"url":"file:///secret","title":"bad","description":"bad"},"parentTempId":null,"referenceTempIds":[]}]}`, errorFragment: "http or https"},
		{name: "duplicate reference", toolName: canvasPlanToolName, arguments: `{"nodes":[{"tempId":"one","cardType":"note","content":{"noteContent":"1"},"parentTempId":null,"referenceTempIds":["two","two"]},{"tempId":"two","cardType":"note","content":{"noteContent":"2"},"parentTempId":null,"referenceTempIds":[]}]}`, errorFragment: "duplicated"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := parseCanvasPlanToolCall(OpenAIToolCall{Name: testCase.toolName, Arguments: testCase.arguments})
			if err == nil || !strings.Contains(err.Error(), testCase.errorFragment) {
				t.Fatalf("parse error = %v want %q", err, testCase.errorFragment)
			}
		})
	}
}
