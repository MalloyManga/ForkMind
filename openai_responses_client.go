package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const openAIWebSearchToolType = "web_search"

type openAIResponsesToolDefinition struct {
	Type        string          `json:"type"`
	Name        string          `json:"name,omitempty"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters,omitempty"`
}

type openAIResponsesRequest struct {
	Model           string                          `json:"model"`
	Input           []openAIResponsesInputMessage   `json:"input"`
	Stream          bool                            `json:"stream"`
	MaxOutputTokens int                             `json:"max_output_tokens"`
	Tools           []openAIResponsesToolDefinition `json:"tools"`
	ToolChoice      string                          `json:"tool_choice"`
}

type openAIResponsesInputMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type openAIResponsesInputContentPart struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	ImageURL string `json:"image_url,omitempty"`
}

type openAIResponsesStreamEvent struct {
	Type    string `json:"type"`
	Delta   string `json:"delta"`
	Message string `json:"message"`
	Item    struct {
		ID        string `json:"id"`
		Type      string `json:"type"`
		CallID    string `json:"call_id"`
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"item"`
	Annotation struct {
		Type  string `json:"type"`
		URL   string `json:"url"`
		Title string `json:"title"`
	} `json:"annotation"`
	Response struct {
		Status string `json:"status"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	} `json:"response"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

type openAIWebCitation struct {
	URL   string
	Title string
}

// StreamNativeWebSearch 通过 Provider 托管的 Responses web_search 工具执行本轮联网请求
// ctx 来自 AIRequestManager 的可取消上下文 request 来自 Bridge 已组装的模型配置和消息 onChunk 复用普通生成的 Wails 增量事件出口
// 返回值保持 OpenAIStreamResult 形状 使 Bridge 可以继续处理画布提案和统一完成事件 Provider 不支持 Responses 或 web_search 时返回可分类的 HTTP 错误
// 用户在右侧栏为单次发送开启联网后触发 关闭联网的请求仍走 StreamCompletion
func (client *OpenAIClient) StreamNativeWebSearch(
	ctx context.Context,
	request openAIStreamRequest,
	onChunk func(content string) error,
) (OpenAIStreamResult, error) {
	if client == nil || client.httpClient == nil {
		return OpenAIStreamResult{}, fmt.Errorf("OpenAI client is unavailable")
	}
	endpoint, err := resolveOpenAIResponsesURL(request.BaseURL)
	if err != nil {
		return OpenAIStreamResult{}, err
	}
	if strings.TrimSpace(request.Model) == "" {
		return OpenAIStreamResult{}, fmt.Errorf("model cannot be empty")
	}
	if len(request.Messages) == 0 {
		return OpenAIStreamResult{}, fmt.Errorf("messages cannot be empty")
	}
	if request.MaxTokens <= 0 {
		return OpenAIStreamResult{}, fmt.Errorf("maxTokens must be positive")
	}

	responsesInput, err := buildOpenAIResponsesInput(request.Messages)
	if err != nil {
		return OpenAIStreamResult{}, err
	}
	requestBody := openAIResponsesRequest{
		Model:           request.Model,
		Input:           responsesInput,
		Stream:          true,
		MaxOutputTokens: request.MaxTokens,
		Tools:           buildOpenAIResponsesTools(request.Tools),
		ToolChoice:      "auto",
	}
	encodedRequest, err := json.Marshal(requestBody)
	if err != nil {
		return OpenAIStreamResult{}, fmt.Errorf("encode OpenAI Responses request: %w", err)
	}

	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encodedRequest))
	if err != nil {
		return OpenAIStreamResult{}, fmt.Errorf("create OpenAI Responses request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Accept", "text/event-stream")
	if apiKey := strings.TrimSpace(request.APIKey); apiKey != "" {
		httpRequest.Header.Set("Authorization", "Bearer "+apiKey)
	}

	response, err := client.httpClient.Do(httpRequest)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return OpenAIStreamResult{}, context.Canceled
		}
		return OpenAIStreamResult{}, fmt.Errorf("send OpenAI Responses request: %w", err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		providerErr := decodeOpenAIHTTPError(response)
		if closeErr := response.Body.Close(); closeErr != nil {
			return OpenAIStreamResult{}, fmt.Errorf("provider error: %v; close response body: %w", providerErr, closeErr)
		}
		return OpenAIStreamResult{}, providerErr
	}

	result, streamErr := consumeOpenAIResponsesEventStream(response.Body, onChunk)
	closeErr := response.Body.Close()
	if streamErr != nil {
		if closeErr != nil {
			return OpenAIStreamResult{}, fmt.Errorf("consume Responses stream: %v; close response body: %w", streamErr, closeErr)
		}
		return OpenAIStreamResult{}, streamErr
	}
	if closeErr != nil {
		return OpenAIStreamResult{}, fmt.Errorf("close OpenAI Responses body: %w", closeErr)
	}

	return result, nil
}

// buildOpenAIResponsesInput 把内部统一消息转换成 Responses API 输入格式
// messages 来自文件 URL 和图片参考资料完成组装后的 AIRuntimeContextDTO
// 返回值保持纯文本 content 为 string 带图片的用户消息改用 input_text 和 input_image blocks
// 原生联网请求编码前触发 避免把 Chat Completions 的 image_url 对象错误发送到 /responses
func buildOpenAIResponsesInput(messages []OpenAIMessageDTO) ([]openAIResponsesInputMessage, error) {
	input := make([]openAIResponsesInputMessage, 0, len(messages))
	for _, message := range messages {
		var encodedContent []byte
		var err error
		if len(message.ImageDataURLs) == 0 {
			encodedContent, err = json.Marshal(message.Content)
		} else {
			contentParts := make([]openAIResponsesInputContentPart, 0, len(message.ImageDataURLs)+1)
			contentParts = append(contentParts, openAIResponsesInputContentPart{
				Type: "input_text",
				Text: message.Content,
			})
			for _, imageDataURL := range message.ImageDataURLs {
				contentParts = append(contentParts, openAIResponsesInputContentPart{
					Type:     "input_image",
					ImageURL: imageDataURL,
				})
			}
			encodedContent, err = json.Marshal(contentParts)
		}
		if err != nil {
			return nil, fmt.Errorf("encode OpenAI Responses input message: %w", err)
		}
		input = append(input, openAIResponsesInputMessage{
			Role:    message.Role,
			Content: encodedContent,
		})
	}
	return input, nil
}

// buildOpenAIResponsesTools 把 Chat Completions 的函数定义转换成 Responses API 的扁平函数结构
// functionTools 来自当前 Bridge 的业务工具集合 返回值始终先包含 Provider 托管的 web_search 工具
// 联网请求编码前触发 画布计划工具仍由模型按需选择且不会绕过 Zustand 审批流程
func buildOpenAIResponsesTools(functionTools []openAIToolDefinition) []openAIResponsesToolDefinition {
	tools := make([]openAIResponsesToolDefinition, 0, len(functionTools)+1)
	tools = append(tools, openAIResponsesToolDefinition{Type: openAIWebSearchToolType})
	for _, functionTool := range functionTools {
		tools = append(tools, openAIResponsesToolDefinition{
			Type:        functionTool.Type,
			Name:        functionTool.Function.Name,
			Description: functionTool.Function.Description,
			Parameters:  functionTool.Function.Parameters,
		})
	}
	return tools
}

// resolveOpenAIResponsesURL 把用户 Base URL 规范到同一 Provider 的 /responses 端点
// baseURL 来自 AI Connection 可以是 /v1 根地址或现有完整端点 返回值保留查询参数并校验 HTTP scheme 与 host
// 仅在本轮允许联网时由 StreamNativeWebSearch 调用
func resolveOpenAIResponsesURL(baseURL string) (string, error) {
	return resolveOpenAIEndpointURL(baseURL, openAIResponsesPath)
}

// consumeOpenAIResponsesEventStream 消费 Responses API 的类型化 SSE 事件
// reader 来自 Provider HTTP Body onChunk 把 output_text.delta 继续送入现有卡片流式状态机
// 返回模型最终状态和业务函数调用 URL 引用会在流结束前补成 Markdown 来源列表
// StreamNativeWebSearch 收到 2xx SSE 响应后触发
func consumeOpenAIResponsesEventStream(
	reader io.Reader,
	onChunk func(content string) error,
) (OpenAIStreamResult, error) {
	bufferedReader := bufio.NewReader(reader)
	result := OpenAIStreamResult{}
	citations := make([]openAIWebCitation, 0)
	seenCitationURLs := make(map[string]struct{})

	for {
		line, readErr := bufferedReader.ReadString('\n')
		trimmedLine := strings.TrimSpace(line)
		if strings.HasPrefix(trimmedLine, "data:") {
			data := strings.TrimSpace(strings.TrimPrefix(trimmedLine, "data:"))
			if data == "[DONE]" {
				if err := emitOpenAIWebCitations(citations, onChunk); err != nil {
					return OpenAIStreamResult{}, err
				}
				return result, nil
			}
			if data != "" {
				var event openAIResponsesStreamEvent
				if err := json.Unmarshal([]byte(data), &event); err != nil {
					return OpenAIStreamResult{}, fmt.Errorf("decode OpenAI Responses stream event: %w", err)
				}
				switch event.Type {
				case "response.output_text.delta":
					if event.Delta != "" {
						if err := onChunk(event.Delta); err != nil {
							return OpenAIStreamResult{}, fmt.Errorf("handle OpenAI Responses chunk: %w", err)
						}
					}
				case "response.output_text.annotation.added":
					citation, valid := normalizeOpenAIWebCitation(event.Annotation.URL, event.Annotation.Title)
					if valid {
						if _, seen := seenCitationURLs[citation.URL]; !seen {
							seenCitationURLs[citation.URL] = struct{}{}
							citations = append(citations, citation)
						}
					}
				case "response.output_item.done":
					if event.Item.Type == "function_call" {
						result.ToolCalls = append(result.ToolCalls, OpenAIToolCall{
							ID:        event.Item.CallID,
							Name:      event.Item.Name,
							Arguments: event.Item.Arguments,
						})
					}
				case "response.completed":
					result.FinishReason = event.Response.Status
				case "response.incomplete":
					result.FinishReason = event.Response.Status
				case "response.failed":
					message := "OpenAI Responses request failed"
					if event.Response.Error != nil && strings.TrimSpace(event.Response.Error.Message) != "" {
						message = strings.TrimSpace(event.Response.Error.Message)
					}
					return OpenAIStreamResult{}, fmt.Errorf("%s", message)
				case "error":
					message := "OpenAI Responses stream failed"
					if strings.TrimSpace(event.Message) != "" {
						message = strings.TrimSpace(event.Message)
					} else if event.Error != nil && strings.TrimSpace(event.Error.Message) != "" {
						message = strings.TrimSpace(event.Error.Message)
					}
					return OpenAIStreamResult{}, fmt.Errorf("%s", message)
				}
			}
		}

		if errors.Is(readErr, io.EOF) {
			if err := emitOpenAIWebCitations(citations, onChunk); err != nil {
				return OpenAIStreamResult{}, err
			}
			return result, nil
		}
		if readErr != nil {
			return OpenAIStreamResult{}, fmt.Errorf("read OpenAI Responses stream: %w", readErr)
		}
	}
}

// normalizeOpenAIWebCitation 校验 Provider 返回的引用 URL 并清理标题
// rawURL 和 rawTitle 来自 response.output_text.annotation.added 返回值只允许 HTTP(S) URL 无效引用返回 false
// 流式解析引用事件时触发 防止把不可信协议写入最终 Markdown
func normalizeOpenAIWebCitation(rawURL string, rawTitle string) (openAIWebCitation, bool) {
	normalizedURL := strings.TrimSpace(rawURL)
	parsedURL, err := url.Parse(normalizedURL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Host == "" {
		return openAIWebCitation{}, false
	}

	normalizedTitle := strings.TrimSpace(strings.NewReplacer("\r", " ", "\n", " ", "[", "", "]", "").Replace(rawTitle))
	if normalizedTitle == "" {
		normalizedTitle = parsedURL.Host
	}
	return openAIWebCitation{URL: normalizedURL, Title: normalizedTitle}, true
}

// emitOpenAIWebCitations 把已去重的 Provider 引用追加为卡片可渲染的 Markdown 来源区
// citations 来自单次 Responses 流 onChunk 是现有 Wails 文本增量出口 空引用不会产生任何输出
// 收到 DONE 或正常 EOF 时触发 让用户能直接看到并点击模型原生搜索来源
func emitOpenAIWebCitations(citations []openAIWebCitation, onChunk func(content string) error) error {
	if len(citations) == 0 {
		return nil
	}

	var builder strings.Builder
	builder.WriteString("\n\nSources:\n")
	for _, citation := range citations {
		fmt.Fprintf(&builder, "- [%s](%s)\n", citation.Title, citation.URL)
	}
	if err := onChunk(builder.String()); err != nil {
		return fmt.Errorf("handle OpenAI Responses citations: %w", err)
	}
	return nil
}
