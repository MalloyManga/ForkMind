package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestOpenAIClientStreamNativeWebSearch 验证联网请求切换到 Responses 端点并携带托管搜索与业务函数工具
// 测试同时覆盖文本增量 URL 引用去重 安全协议过滤和画布函数调用解析
func TestOpenAIClientStreamNativeWebSearch(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/responses" {
			t.Errorf("request path = %q, want /v1/responses", request.URL.Path)
		}
		if authorization := request.Header.Get("Authorization"); authorization != "Bearer secret" {
			t.Errorf("Authorization = %q, want Bearer secret", authorization)
		}

		var requestBody openAIResponsesRequest
		if err := json.NewDecoder(request.Body).Decode(&requestBody); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		if requestBody.Model != "search-model" || !requestBody.Stream || requestBody.ToolChoice != "auto" {
			t.Errorf("responses request = %#v", requestBody)
		}
		if len(requestBody.Tools) != 2 || requestBody.Tools[0].Type != openAIWebSearchToolType {
			t.Errorf("responses tools = %#v", requestBody.Tools)
		}
		if requestBody.Tools[1].Type != "function" || requestBody.Tools[1].Name != canvasPlanToolName {
			t.Errorf("function tool = %#v", requestBody.Tools[1])
		}
		if len(requestBody.Input) != 1 || !strings.Contains(string(requestBody.Input[0].Content), `"type":"input_image"`) {
			t.Errorf("responses input = %#v", requestBody.Input)
		}

		responseWriter.Header().Set("Content-Type", "text/event-stream")
		stream := strings.Join([]string{
			`data: {"type":"response.output_text.delta","delta":"联网回答"}`,
			`data: {"type":"response.output_text.annotation.added","annotation":{"type":"url_citation","url":"https://example.com/article","title":"示例 [来源]"}}`,
			`data: {"type":"response.output_text.annotation.added","annotation":{"type":"url_citation","url":"https://example.com/article","title":"重复"}}`,
			`data: {"type":"response.output_text.annotation.added","annotation":{"type":"url_citation","url":"javascript:alert(1)","title":"危险"}}`,
			`data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call-plan","name":"propose_canvas_plan","arguments":"{\"nodes\":[]}"}}`,
			`data: {"type":"response.completed","response":{"status":"completed"}}`,
			"data: [DONE]",
			"",
		}, "\n\n")
		if _, err := responseWriter.Write([]byte(stream)); err != nil {
			t.Errorf("write Responses SSE: %v", err)
		}
	}))
	defer server.Close()

	client := newOpenAIClientWithHTTPClient(server.Client())
	chunks := make([]string, 0)
	result, err := client.StreamNativeWebSearch(
		context.Background(),
		openAIStreamRequest{
			BaseURL: server.URL + "/v1/chat/completions",
			APIKey:  "secret",
			Model:   "search-model",
			Messages: []OpenAIMessageDTO{{
				Role:          openAIRoleUser,
				Content:       "查询最新信息",
				ImageDataURLs: []string{"data:image/png;base64,AA=="},
			}},
			Temperature: 0.7,
			MaxTokens:   512,
			Tools:       []openAIToolDefinition{canvasPlanToolDefinition()},
		},
		func(content string) error {
			chunks = append(chunks, content)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("StreamNativeWebSearch() error = %v", err)
	}
	joined := strings.Join(chunks, "")
	if !strings.Contains(joined, "联网回答") || !strings.Contains(joined, "[示例 来源](https://example.com/article)") {
		t.Fatalf("joined chunks = %q", joined)
	}
	if strings.Count(joined, "https://example.com/article") != 1 || strings.Contains(joined, "javascript:") {
		t.Fatalf("citation filtering failed: %q", joined)
	}
	if result.FinishReason != "completed" || len(result.ToolCalls) != 1 {
		t.Fatalf("stream result = %#v", result)
	}
	if toolCall := result.ToolCalls[0]; toolCall.ID != "call-plan" || toolCall.Name != canvasPlanToolName || toolCall.Arguments != `{"nodes":[]}` {
		t.Fatalf("tool call = %#v", toolCall)
	}
}

// TestResolveOpenAIResponsesURL 验证普通 Base URL 与已有完整端点都能稳定切换到 /responses
// 用户可以继续只填写一个 Base URL 不需要理解两套 Provider 地址
func TestResolveOpenAIResponsesURL(t *testing.T) {
	t.Parallel()

	validCases := map[string]string{
		" http://localhost:11434/v1 ":                  "http://localhost:11434/v1/responses",
		"https://provider.example/v1/":                 "https://provider.example/v1/responses",
		"https://provider.example/v1/responses":        "https://provider.example/v1/responses",
		"https://provider.example/v1/chat/completions": "https://provider.example/v1/responses",
	}
	for input, expected := range validCases {
		actual, err := resolveOpenAIResponsesURL(input)
		if err != nil || actual != expected {
			t.Fatalf("resolveOpenAIResponsesURL(%q) = (%q, %v), want %q", input, actual, err, expected)
		}
	}
}

// TestConsumeOpenAIResponsesEventStreamErrors 验证协议损坏 Provider 失败与消费回调错误都不会被吞掉
// 这些错误最终会由 Bridge 转换成稳定的 AI error 事件
func TestConsumeOpenAIResponsesEventStreamErrors(t *testing.T) {
	t.Parallel()

	if _, err := consumeOpenAIResponsesEventStream(strings.NewReader("data: {bad}\n"), func(string) error { return nil }); err == nil || !strings.Contains(err.Error(), "decode OpenAI Responses") {
		t.Fatalf("malformed stream error = %v", err)
	}
	if _, err := consumeOpenAIResponsesEventStream(
		strings.NewReader(`data: {"type":"response.failed","response":{"status":"failed","error":{"message":"search unavailable"}}}`+"\n"),
		func(string) error { return nil },
	); err == nil || !strings.Contains(err.Error(), "search unavailable") {
		t.Fatalf("provider stream error = %v", err)
	}

	callbackError := errors.New("consumer failed")
	if _, err := consumeOpenAIResponsesEventStream(
		strings.NewReader(`data: {"type":"response.output_text.delta","delta":"chunk"}`+"\n"),
		func(string) error { return callbackError },
	); err == nil || !strings.Contains(err.Error(), "handle OpenAI Responses chunk") {
		t.Fatalf("callback error = %v", err)
	}
}

// TestOpenAIClientStreamNativeWebSearchValidation 验证联网路径在发起网络请求前拒绝空模型 空消息和无效 token 上限
// 与普通 Chat Completions 保持相同的运行时参数边界
func TestOpenAIClientStreamNativeWebSearchValidation(t *testing.T) {
	t.Parallel()

	validRequest := openAIStreamRequest{
		BaseURL:     "http://provider.example/v1",
		Model:       "model",
		Messages:    []OpenAIMessageDTO{{Role: openAIRoleUser, Content: "prompt"}},
		Temperature: 0.7,
		MaxTokens:   10,
	}
	client := newOpenAIClientWithHTTPClient(&http.Client{})
	for _, mutate := range []func(*openAIStreamRequest){
		func(request *openAIStreamRequest) { request.Model = " " },
		func(request *openAIStreamRequest) { request.Messages = nil },
		func(request *openAIStreamRequest) { request.MaxTokens = 0 },
	} {
		request := validRequest
		mutate(&request)
		if _, err := client.StreamNativeWebSearch(context.Background(), request, func(string) error { return nil }); err == nil {
			t.Fatal("StreamNativeWebSearch() validation error = nil")
		}
	}
}
