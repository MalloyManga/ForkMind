package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

const (
	canvasPlanToolName            = "propose_canvas_plan"
	canvasPlanSchemaVersion       = 1
	maxCanvasPlanNodes            = 40
	maxCanvasPlanReferences       = 200
	maxCanvasPlanTextLength       = 20000
	maxCanvasPlanToolArgumentSize = 2 * 1024 * 1024
)

var canvasPlanTempIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// CanvasPlanDTO 是模型提出但尚未写入业务 Store 的完整画布方案
// Nodes 保持模型给出的顺序 React 接受后会用该顺序确定稳定布局
type CanvasPlanDTO struct {
	Nodes []CanvasPlanNodeDTO `json:"nodes"`
}

// CanvasPlanNodeDTO 使用临时 id 表达提案内部关系
// Content 已按 CardType 严格校验但保留原始判别对象供 React 再次执行边界校验
type CanvasPlanNodeDTO struct {
	TempID           string          `json:"tempId"`
	CardType         string          `json:"cardType"`
	Content          json.RawMessage `json:"content"`
	ParentTempID     *string         `json:"parentTempId"`
	ReferenceTempIDs []string        `json:"referenceTempIds"`
}

type canvasPlanChatContent struct {
	UserPrompt string `json:"userPrompt"`
	AIResponse string `json:"aiResponse"`
}

type canvasPlanNoteContent struct {
	NoteContent string `json:"noteContent"`
}

type canvasPlanImageContent struct {
	Caption string `json:"caption"`
	AltText string `json:"altText"`
}

type canvasPlanLinkContent struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

type canvasPlanFileContent struct {
	Description string `json:"description"`
}

// canvasPlanToolDefinition 返回发送给 OpenAI-compatible Provider 的唯一粗粒度工具
// 返回值由 StreamCompletion 写入 tools 数组 模型只需要一次调用即可描述全部卡片和关系
func canvasPlanToolDefinition() openAIToolDefinition {
	return openAIToolDefinition{
		Type: "function",
		Function: openAIFunctionDefinition{
			Name:        canvasPlanToolName,
			Description: "当用户明确要求生成或组织 ForkMind 画布卡片时调用 一次返回全部卡片及其父子和参考关系 不要生成真实数据库 id",
			Parameters: json.RawMessage(`{
  "type":"object",
  "additionalProperties":false,
  "required":["nodes"],
  "properties":{
    "nodes":{
      "type":"array",
      "minItems":1,
      "maxItems":40,
      "items":{
        "oneOf":[
          {"type":"object","additionalProperties":false,"required":["tempId","cardType","content","parentTempId","referenceTempIds"],"properties":{"tempId":{"type":"string"},"cardType":{"const":"chat"},"content":{"type":"object","additionalProperties":false,"required":["userPrompt","aiResponse"],"properties":{"userPrompt":{"type":"string"},"aiResponse":{"type":"string"}}},"parentTempId":{"type":["string","null"]},"referenceTempIds":{"type":"array","items":{"type":"string"},"uniqueItems":true}}},
          {"type":"object","additionalProperties":false,"required":["tempId","cardType","content","parentTempId","referenceTempIds"],"properties":{"tempId":{"type":"string"},"cardType":{"const":"note"},"content":{"type":"object","additionalProperties":false,"required":["noteContent"],"properties":{"noteContent":{"type":"string"}}},"parentTempId":{"type":["string","null"]},"referenceTempIds":{"type":"array","items":{"type":"string"},"uniqueItems":true}}},
          {"type":"object","additionalProperties":false,"required":["tempId","cardType","content","parentTempId","referenceTempIds"],"properties":{"tempId":{"type":"string"},"cardType":{"const":"image"},"content":{"type":"object","additionalProperties":false,"required":["caption","altText"],"properties":{"caption":{"type":"string"},"altText":{"type":"string"}}},"parentTempId":{"type":["string","null"]},"referenceTempIds":{"type":"array","items":{"type":"string"},"uniqueItems":true}}},
          {"type":"object","additionalProperties":false,"required":["tempId","cardType","content","parentTempId","referenceTempIds"],"properties":{"tempId":{"type":"string"},"cardType":{"const":"link"},"content":{"type":"object","additionalProperties":false,"required":["url","title","description"],"properties":{"url":{"type":"string"},"title":{"type":"string"},"description":{"type":"string"}}},"parentTempId":{"type":["string","null"]},"referenceTempIds":{"type":"array","items":{"type":"string"},"uniqueItems":true}}},
          {"type":"object","additionalProperties":false,"required":["tempId","cardType","content","parentTempId","referenceTempIds"],"properties":{"tempId":{"type":"string"},"cardType":{"const":"file"},"content":{"type":"object","additionalProperties":false,"required":["description"],"properties":{"description":{"type":"string"}}},"parentTempId":{"type":["string","null"]},"referenceTempIds":{"type":"array","items":{"type":"string"},"uniqueItems":true}}}
        ]
      }
    }
  }
}`),
		},
	}
}

// parseCanvasPlanToolCall 校验模型工具名称 参数大小 JSON 字段和全部关系约束
// toolCall 来自单次 OpenAI 流式结果 返回值只是一份待审批提案不会直接写入工作区
func parseCanvasPlanToolCall(toolCall OpenAIToolCall) (CanvasPlanDTO, error) {
	if toolCall.Name != canvasPlanToolName {
		return CanvasPlanDTO{}, fmt.Errorf("unsupported tool call %q", toolCall.Name)
	}
	if len(toolCall.Arguments) > maxCanvasPlanToolArgumentSize {
		return CanvasPlanDTO{}, fmt.Errorf("canvas plan tool arguments exceed %d bytes", maxCanvasPlanToolArgumentSize)
	}

	decoder := json.NewDecoder(strings.NewReader(toolCall.Arguments))
	decoder.DisallowUnknownFields()
	var plan CanvasPlanDTO
	if err := decoder.Decode(&plan); err != nil {
		return CanvasPlanDTO{}, fmt.Errorf("decode canvas plan: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return CanvasPlanDTO{}, fmt.Errorf("decode canvas plan: %w", err)
	}
	if err := validateCanvasPlan(plan); err != nil {
		return CanvasPlanDTO{}, err
	}
	return plan, nil
}

// validateCanvasPlan 检查提案节点内容 临时关系和父链无环约束
// plan 来自严格 JSON 解码 返回 nil 表示可以安全发给 React 等待用户审批
func validateCanvasPlan(plan CanvasPlanDTO) error {
	if len(plan.Nodes) == 0 || len(plan.Nodes) > maxCanvasPlanNodes {
		return fmt.Errorf("canvas plan nodes must contain between 1 and %d items", maxCanvasPlanNodes)
	}

	nodeByTempID := make(map[string]CanvasPlanNodeDTO, len(plan.Nodes))
	referenceCount := 0
	for nodeIndex, node := range plan.Nodes {
		if !canvasPlanTempIDPattern.MatchString(node.TempID) {
			return fmt.Errorf("nodes[%d].tempId is invalid", nodeIndex)
		}
		if _, exists := nodeByTempID[node.TempID]; exists {
			return fmt.Errorf("nodes[%d].tempId %q is duplicated", nodeIndex, node.TempID)
		}
		if err := validateCanvasPlanNodeContent(node); err != nil {
			return fmt.Errorf("nodes[%d].content: %w", nodeIndex, err)
		}
		nodeByTempID[node.TempID] = node
		referenceCount += len(node.ReferenceTempIDs)
	}
	if referenceCount > maxCanvasPlanReferences {
		return fmt.Errorf("canvas plan references exceed %d items", maxCanvasPlanReferences)
	}

	for nodeIndex, node := range plan.Nodes {
		if node.ParentTempID != nil {
			if *node.ParentTempID == node.TempID {
				return fmt.Errorf("nodes[%d].parentTempId cannot reference itself", nodeIndex)
			}
			if _, exists := nodeByTempID[*node.ParentTempID]; !exists {
				return fmt.Errorf("nodes[%d].parentTempId %q does not exist", nodeIndex, *node.ParentTempID)
			}
		}
		seenReferences := make(map[string]struct{}, len(node.ReferenceTempIDs))
		for _, referenceTempID := range node.ReferenceTempIDs {
			if referenceTempID == node.TempID {
				return fmt.Errorf("nodes[%d].referenceTempIds cannot reference itself", nodeIndex)
			}
			if _, exists := nodeByTempID[referenceTempID]; !exists {
				return fmt.Errorf("nodes[%d].referenceTempId %q does not exist", nodeIndex, referenceTempID)
			}
			if _, duplicated := seenReferences[referenceTempID]; duplicated {
				return fmt.Errorf("nodes[%d].referenceTempId %q is duplicated", nodeIndex, referenceTempID)
			}
			seenReferences[referenceTempID] = struct{}{}
		}
	}

	for _, node := range plan.Nodes {
		visited := map[string]struct{}{node.TempID: {}}
		parentTempID := node.ParentTempID
		for parentTempID != nil {
			if _, exists := visited[*parentTempID]; exists {
				return fmt.Errorf("canvas plan parent relation contains a cycle at %q", *parentTempID)
			}
			visited[*parentTempID] = struct{}{}
			parentNode := nodeByTempID[*parentTempID]
			parentTempID = parentNode.ParentTempID
		}
	}

	return nil
}

// validateCanvasPlanNodeContent 按 cardType 严格解码 content 判别对象
// node 来自模型提案 返回错误表示字段越界 文本超限或 Link URL 不安全
func validateCanvasPlanNodeContent(node CanvasPlanNodeDTO) error {
	validateText := func(fieldName string, value string) error {
		if len(value) > maxCanvasPlanTextLength {
			return fmt.Errorf("%s exceeds %d characters", fieldName, maxCanvasPlanTextLength)
		}
		return nil
	}

	switch node.CardType {
	case "chat":
		var content canvasPlanChatContent
		if err := decodeStrictCanvasPlanContent(node.Content, &content); err != nil {
			return err
		}
		if err := validateText("userPrompt", content.UserPrompt); err != nil {
			return err
		}
		return validateText("aiResponse", content.AIResponse)
	case "note":
		var content canvasPlanNoteContent
		if err := decodeStrictCanvasPlanContent(node.Content, &content); err != nil {
			return err
		}
		return validateText("noteContent", content.NoteContent)
	case "image":
		var content canvasPlanImageContent
		if err := decodeStrictCanvasPlanContent(node.Content, &content); err != nil {
			return err
		}
		if err := validateText("caption", content.Caption); err != nil {
			return err
		}
		return validateText("altText", content.AltText)
	case "link":
		var content canvasPlanLinkContent
		if err := decodeStrictCanvasPlanContent(node.Content, &content); err != nil {
			return err
		}
		for fieldName, value := range map[string]string{"url": content.URL, "title": content.Title, "description": content.Description} {
			if err := validateText(fieldName, value); err != nil {
				return err
			}
		}
		parsedURL, err := url.ParseRequestURI(strings.TrimSpace(content.URL))
		if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Host == "" {
			return fmt.Errorf("url must use http or https")
		}
		return nil
	case "file":
		var content canvasPlanFileContent
		if err := decodeStrictCanvasPlanContent(node.Content, &content); err != nil {
			return err
		}
		return validateText("description", content.Description)
	default:
		return fmt.Errorf("unsupported cardType %q", node.CardType)
	}
}

// decodeStrictCanvasPlanContent 解码单个 cardType 对应的 content
// target 是当前 switch 分支的具体结构 额外字段和多顶层 JSON 都会被拒绝
func decodeStrictCanvasPlanContent(content json.RawMessage, target interface{}) error {
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode content: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return fmt.Errorf("decode content: %w", err)
	}
	return nil
}
