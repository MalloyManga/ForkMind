package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	openAIChatCompletionsPath = "/chat/completions"
	maxOpenAIErrorBodyBytes   = 1024 * 1024
	defaultOpenAITemperature  = 0.7
	defaultOpenAIMaxTokens    = 4096
)

// OpenAICompletionConfigDTO 是一次请求使用的 OpenAI-compatible 配置
// APIKey 只通过本次 Bridge 调用存在于 Go 内存 不会进入 WorkspaceDocumentDTO
type OpenAICompletionConfigDTO struct {
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
}

type openAIStreamRequest struct {
	BaseURL     string
	APIKey      string
	Model       string
	Messages    []OpenAIMessageDTO
	Temperature float64
	MaxTokens   int
	Tools       []openAIToolDefinition
}

type openAIFunctionDefinition struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

type openAIToolDefinition struct {
	Type     string                   `json:"type"`
	Function openAIFunctionDefinition `json:"function"`
}

type openAIChatCompletionsRequest struct {
	Model       string                 `json:"model"`
	Messages    []OpenAIMessageDTO     `json:"messages"`
	Stream      bool                   `json:"stream"`
	Temperature float64                `json:"temperature"`
	MaxTokens   int                    `json:"max_tokens"`
	Tools       []openAIToolDefinition `json:"tools,omitempty"`
	ToolChoice  string                 `json:"tool_choice,omitempty"`
}

type openAIStreamChunk struct {
	Choices []struct {
		Delta struct {
			Content   string `json:"content"`
			ToolCalls []struct {
				Index    int    `json:"index"`
				ID       string `json:"id"`
				Type     string `json:"type"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

type openAIErrorEnvelope struct {
	Error struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code"`
	} `json:"error"`
}

// OpenAIStreamResult 表示一次 SSE 完成后的结算信息
type OpenAIStreamResult struct {
	FinishReason string
	ToolCalls    []OpenAIToolCall
}

// OpenAIToolCall 是流式 delta.tool_calls 按 index 聚合后的完整函数调用
type OpenAIToolCall struct {
	ID        string
	Name      string
	Arguments string
}

// OpenAIHTTPError 保留 Provider HTTP 状态码与可读消息
// Bridge 使用 StatusCode 判断是否适合重试
type OpenAIHTTPError struct {
	StatusCode int
	Message    string
}

func (streamError *OpenAIHTTPError) Error() string {
	return fmt.Sprintf("OpenAI-compatible request failed with status %d: %s", streamError.StatusCode, streamError.Message)
}

// OpenAIClient 执行 OpenAI-compatible HTTP 请求
// httpClient 可以在测试中注入 httptest Client 生产环境使用带连接超时的默认实现
type OpenAIClient struct {
	httpClient *http.Client
}

// NewOpenAIClient 创建生产环境 Client
// 流式响应没有整体 Timeout 请求取消由 context 控制 Transport 只限制建连和响应头等待
func NewOpenAIClient() *OpenAIClient {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{
		Timeout:   15 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext
	transport.TLSHandshakeTimeout = 15 * time.Second
	transport.ResponseHeaderTimeout = 60 * time.Second
	transport.IdleConnTimeout = 90 * time.Second

	return &OpenAIClient{
		httpClient: &http.Client{Transport: transport},
	}
}

// newOpenAIClientWithHTTPClient 创建测试 Client
// httpClient 由 httptest Server 提供 不用于 Wails 生产路径
func newOpenAIClientWithHTTPClient(httpClient *http.Client) *OpenAIClient {
	return &OpenAIClient{httpClient: httpClient}
}

// StreamCompletion 发起 OpenAI-compatible SSE 请求
// request 包含本轮模型配置与已经组装好的 messages
// onChunk 每收到一段非空 delta.content 调用一次 返回错误会立即取消流并向上返回
func (client *OpenAIClient) StreamCompletion(
	ctx context.Context,
	request openAIStreamRequest,
	onChunk func(content string) error,
) (OpenAIStreamResult, error) {
	if client == nil || client.httpClient == nil {
		return OpenAIStreamResult{}, fmt.Errorf("OpenAI client is unavailable")
	}
	endpoint, err := resolveOpenAIChatCompletionsURL(request.BaseURL)
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

	requestBody := openAIChatCompletionsRequest{
		Model:       request.Model,
		Messages:    request.Messages,
		Stream:      true,
		Temperature: request.Temperature,
		MaxTokens:   request.MaxTokens,
		Tools:       request.Tools,
	}
	if len(request.Tools) > 0 {
		requestBody.ToolChoice = "auto"
	}
	encodedRequest, err := json.Marshal(requestBody)
	if err != nil {
		return OpenAIStreamResult{}, fmt.Errorf("encode OpenAI request: %w", err)
	}

	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(encodedRequest),
	)
	if err != nil {
		return OpenAIStreamResult{}, fmt.Errorf("create OpenAI request: %w", err)
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
		return OpenAIStreamResult{}, fmt.Errorf("send OpenAI request: %w", err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		providerErr := decodeOpenAIHTTPError(response)
		if closeErr := response.Body.Close(); closeErr != nil {
			return OpenAIStreamResult{}, fmt.Errorf("provider error: %v; close response body: %w", providerErr, closeErr)
		}
		return OpenAIStreamResult{}, providerErr
	}

	result, streamErr := consumeOpenAIEventStream(response.Body, onChunk)
	closeErr := response.Body.Close()
	if streamErr != nil {
		if closeErr != nil {
			return OpenAIStreamResult{}, fmt.Errorf("consume stream: %v; close response body: %w", streamErr, closeErr)
		}
		return OpenAIStreamResult{}, streamErr
	}
	if closeErr != nil {
		return OpenAIStreamResult{}, fmt.Errorf("close OpenAI response body: %w", closeErr)
	}

	return result, nil
}

// resolveOpenAIChatCompletionsURL 把用户 Base URL 规范为完整端点
// Base URL 可以是 http://localhost:11434/v1 或已经包含 /chat/completions 的完整地址
func resolveOpenAIChatCompletionsURL(baseURL string) (string, error) {
	return resolveOpenAIEndpointURL(baseURL, openAIChatCompletionsPath)
}

// resolveOpenAIEndpointURL 在同一个 OpenAI-compatible Base URL 下切换标准端点
// baseURL 来自用户连接配置 endpointPath 由内部调用方传入 /chat/completions
// 返回经过 scheme host 校验的完整 URL Base URL 为空或不是 HTTP(S) 时返回错误
// 流式生成在创建 HTTP request 前调用
func resolveOpenAIEndpointURL(baseURL string, endpointPath string) (string, error) {
	normalizedBaseURL := strings.TrimSpace(baseURL)
	if normalizedBaseURL == "" {
		return "", fmt.Errorf("baseUrl cannot be empty")
	}

	parsedURL, err := url.Parse(normalizedBaseURL)
	if err != nil {
		return "", fmt.Errorf("parse baseUrl: %w", err)
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return "", fmt.Errorf("baseUrl scheme must be http or https")
	}
	if parsedURL.Host == "" {
		return "", fmt.Errorf("baseUrl host cannot be empty")
	}

	trimmedPath := strings.TrimRight(parsedURL.Path, "/")
	for _, knownEndpointPath := range []string{openAIChatCompletionsPath} {
		if strings.HasSuffix(trimmedPath, knownEndpointPath) {
			trimmedPath = strings.TrimSuffix(trimmedPath, knownEndpointPath)
			break
		}
	}
	parsedURL.Path = strings.TrimRight(trimmedPath, "/") + endpointPath

	return parsedURL.String(), nil
}

// consumeOpenAIEventStream 逐行消费 OpenAI SSE 数据
// reader 可能在任意字节边界返回数据 bufio.Reader 会把半行安全拼接完整
func consumeOpenAIEventStream(
	reader io.Reader,
	onChunk func(content string) error,
) (OpenAIStreamResult, error) {
	bufferedReader := bufio.NewReader(reader)
	result := OpenAIStreamResult{}
	toolCallByIndex := make(map[int]*OpenAIToolCall)
	toolCallIndexes := make([]int, 0)

	for {
		line, readErr := bufferedReader.ReadString('\n')
		trimmedLine := strings.TrimSpace(line)
		if strings.HasPrefix(trimmedLine, "data:") {
			data := strings.TrimSpace(strings.TrimPrefix(trimmedLine, "data:"))
			if data == "[DONE]" {
				result.ToolCalls = collectOpenAIToolCalls(toolCallByIndex, toolCallIndexes)
				return result, nil
			}
			if data != "" {
				var chunk openAIStreamChunk
				if err := json.Unmarshal([]byte(data), &chunk); err != nil {
					return OpenAIStreamResult{}, fmt.Errorf("decode OpenAI stream chunk: %w", err)
				}
				for _, choice := range chunk.Choices {
					if choice.Delta.Content != "" {
						if err := onChunk(choice.Delta.Content); err != nil {
							return OpenAIStreamResult{}, fmt.Errorf("handle OpenAI stream chunk: %w", err)
						}
					}
					for _, toolCallDelta := range choice.Delta.ToolCalls {
						toolCall, exists := toolCallByIndex[toolCallDelta.Index]
						if !exists {
							toolCall = &OpenAIToolCall{}
							toolCallByIndex[toolCallDelta.Index] = toolCall
							toolCallIndexes = append(toolCallIndexes, toolCallDelta.Index)
						}
						if toolCallDelta.ID != "" {
							toolCall.ID = toolCallDelta.ID
						}
						if toolCallDelta.Function.Name != "" {
							toolCall.Name = toolCallDelta.Function.Name
						}
						toolCall.Arguments += toolCallDelta.Function.Arguments
						if len(toolCall.Arguments) > maxCanvasPlanToolArgumentSize {
							return OpenAIStreamResult{}, fmt.Errorf("OpenAI tool arguments exceed %d bytes", maxCanvasPlanToolArgumentSize)
						}
					}
					if choice.FinishReason != nil {
						result.FinishReason = *choice.FinishReason
					}
				}
			}
		}

		if errors.Is(readErr, io.EOF) {
			result.ToolCalls = collectOpenAIToolCalls(toolCallByIndex, toolCallIndexes)
			return result, nil
		}
		if readErr != nil {
			return OpenAIStreamResult{}, fmt.Errorf("read OpenAI event stream: %w", readErr)
		}
	}
}

// collectOpenAIToolCalls 按 SSE 首次出现的 index 顺序输出完整调用
// toolCallByIndex 和 indexes 来自 consumeOpenAIEventStream 的单次响应聚合状态
func collectOpenAIToolCalls(toolCallByIndex map[int]*OpenAIToolCall, indexes []int) []OpenAIToolCall {
	toolCalls := make([]OpenAIToolCall, 0, len(indexes))
	for _, toolCallIndex := range indexes {
		if toolCall := toolCallByIndex[toolCallIndex]; toolCall != nil {
			toolCalls = append(toolCalls, *toolCall)
		}
	}
	return toolCalls
}

// decodeOpenAIHTTPError 读取 Provider 非 2xx 响应
// 优先解析 OpenAI error.message 解析失败时保留受限长度的原始正文
func decodeOpenAIHTTPError(response *http.Response) error {
	limitedBody := io.LimitReader(response.Body, maxOpenAIErrorBodyBytes)
	responseBody, err := io.ReadAll(limitedBody)
	if err != nil {
		return fmt.Errorf("read OpenAI error response: %w", err)
	}

	message := strings.TrimSpace(string(responseBody))
	var envelope openAIErrorEnvelope
	if err := json.Unmarshal(responseBody, &envelope); err == nil && strings.TrimSpace(envelope.Error.Message) != "" {
		message = strings.TrimSpace(envelope.Error.Message)
	}
	if message == "" {
		message = response.Status
	}

	return &OpenAIHTTPError{
		StatusCode: response.StatusCode,
		Message:    message,
	}
}
