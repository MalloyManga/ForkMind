package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestOpenAIClientStreamCompletion 验证标准 OpenAI SSE Chunk 与 DONE 能被顺序解析
// 同时检查请求端点 模型 messages 和 Authorization Header
func TestOpenAIClientStreamCompletion(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/chat/completions" {
			t.Errorf("request path = %q, want /v1/chat/completions", request.URL.Path)
		}
		if authorization := request.Header.Get("Authorization"); authorization != "Bearer secret" {
			t.Errorf("Authorization = %q, want Bearer secret", authorization)
		}

		var requestBody openAIChatCompletionsRequest
		if err := json.NewDecoder(request.Body).Decode(&requestBody); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		if requestBody.Model != "test-model" {
			t.Errorf("Model = %q, want test-model", requestBody.Model)
		}

		responseWriter.Header().Set("Content-Type", "text/event-stream")
		if _, err := responseWriter.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"},\"finish_reason\":null}]}\n\n")); err != nil {
			t.Errorf("write first SSE chunk: %v", err)
		}
		if _, err := responseWriter.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\n")); err != nil {
			t.Errorf("write second SSE chunk: %v", err)
		}
		if _, err := responseWriter.Write([]byte("data: [DONE]\n\n")); err != nil {
			t.Errorf("write SSE done: %v", err)
		}
	}))
	defer server.Close()

	client := newOpenAIClientWithHTTPClient(server.Client())
	chunks := make([]string, 0)
	result, err := client.StreamCompletion(
		context.Background(),
		openAIStreamRequest{
			BaseURL:     server.URL + "/v1",
			APIKey:      "secret",
			Model:       "test-model",
			Messages:    []OpenAIMessageDTO{{Role: openAIRoleUser, Content: "hello"}},
			Temperature: 0.7,
			MaxTokens:   512,
		},
		func(content string) error {
			chunks = append(chunks, content)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("StreamCompletion() error = %v", err)
	}
	if joined := strings.Join(chunks, ""); joined != "Hello" {
		t.Fatalf("joined chunks = %q, want Hello", joined)
	}
	if result.FinishReason != "stop" {
		t.Fatalf("FinishReason = %q, want stop", result.FinishReason)
	}
}

// TestConsumeOpenAIEventStreamAggregatesToolCallArguments 验证分散在多个 SSE delta 的工具参数按 index 拼接
func TestConsumeOpenAIEventStreamAggregatesToolCallArguments(t *testing.T) {
	t.Parallel()

	stream := strings.Join([]string{
		`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"propose_canvas_plan","arguments":"{\"nodes\":["}}]},"finish_reason":null}]}`,
		`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"]}"}}]},"finish_reason":"tool_calls"}]}`,
		"data: [DONE]",
		"",
	}, "\n\n")
	result, err := consumeOpenAIEventStream(strings.NewReader(stream), func(string) error { return nil })
	if err != nil {
		t.Fatalf("consumeOpenAIEventStream() error = %v", err)
	}
	if result.FinishReason != "tool_calls" || len(result.ToolCalls) != 1 {
		t.Fatalf("stream result = %#v", result)
	}
	if toolCall := result.ToolCalls[0]; toolCall.ID != "call-1" || toolCall.Name != canvasPlanToolName || toolCall.Arguments != `{"nodes":[]}` {
		t.Fatalf("tool call = %#v", toolCall)
	}
}

// TestOpenAIClientReturnsProviderError 验证非 2xx OpenAI error.message 被保留
func TestOpenAIClientReturnsProviderError(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, _ *http.Request) {
		responseWriter.WriteHeader(http.StatusUnauthorized)
		if _, err := responseWriter.Write([]byte(`{"error":{"message":"invalid key","type":"auth_error"}}`)); err != nil {
			t.Errorf("write provider error: %v", err)
		}
	}))
	defer server.Close()

	client := newOpenAIClientWithHTTPClient(server.Client())
	_, err := client.StreamCompletion(
		context.Background(),
		openAIStreamRequest{
			BaseURL:     server.URL,
			Model:       "test-model",
			Messages:    []OpenAIMessageDTO{{Role: openAIRoleUser, Content: "hello"}},
			Temperature: 0.7,
			MaxTokens:   512,
		},
		func(string) error { return nil },
	)
	if err == nil {
		t.Fatal("StreamCompletion() error = nil, want provider error")
	}

	var httpError *OpenAIHTTPError
	if !strings.Contains(err.Error(), "invalid key") {
		t.Fatalf("StreamCompletion() error = %q, want invalid key", err.Error())
	}
	if !errors.As(err, &httpError) || httpError.StatusCode != http.StatusUnauthorized {
		t.Fatalf("StreamCompletion() error = %#v, want OpenAIHTTPError 401", err)
	}
}

// TestNewOpenAIClientTransportDefaults 验证生产 Client 的连接与响应头超时配置
func TestNewOpenAIClientTransportDefaults(t *testing.T) {
	t.Parallel()

	client := NewOpenAIClient()
	if client == nil || client.httpClient == nil {
		t.Fatal("NewOpenAIClient() returned nil runtime")
	}
	transport, ok := client.httpClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("Transport = %T, want *http.Transport", client.httpClient.Transport)
	}
	if transport.TLSHandshakeTimeout != 15*time.Second || transport.ResponseHeaderTimeout != 60*time.Second || transport.IdleConnTimeout != 90*time.Second {
		t.Fatalf("transport timeouts = TLS %s header %s idle %s", transport.TLSHandshakeTimeout, transport.ResponseHeaderTimeout, transport.IdleConnTimeout)
	}
}

// TestResolveOpenAIChatCompletionsURL 验证 Base URL 只规范到标准 chat completions 端点
func TestResolveOpenAIChatCompletionsURL(t *testing.T) {
	t.Parallel()

	validCases := map[string]string{
		" http://localhost:11434/v1 ":                  "http://localhost:11434/v1/chat/completions",
		"https://provider.example/v1/":                 "https://provider.example/v1/chat/completions",
		"https://provider.example/v1/chat/completions": "https://provider.example/v1/chat/completions",
		"https://provider.example/v1?tenant=one":       "https://provider.example/v1/chat/completions?tenant=one",
	}
	for input, expected := range validCases {
		actual, err := resolveOpenAIChatCompletionsURL(input)
		if err != nil || actual != expected {
			t.Fatalf("resolveOpenAIChatCompletionsURL(%q) = (%q, %v), want %q", input, actual, err, expected)
		}
	}

	for _, input := range []string{"", "ftp://provider.example/v1", "/v1", "://bad"} {
		if _, err := resolveOpenAIChatCompletionsURL(input); err == nil {
			t.Fatalf("resolveOpenAIChatCompletionsURL(%q) error = nil", input)
		}
	}
}

// TestOpenAIClientValidationErrors 验证请求在发起网络连接前拒绝无效运行时参数
func TestOpenAIClientValidationErrors(t *testing.T) {
	t.Parallel()

	validRequest := openAIStreamRequest{
		BaseURL:     "http://localhost:11434/v1",
		Model:       "model",
		Messages:    []OpenAIMessageDTO{{Role: openAIRoleUser, Content: "prompt"}},
		Temperature: 0.7,
		MaxTokens:   10,
	}
	if _, err := (*OpenAIClient)(nil).StreamCompletion(context.Background(), validRequest, func(string) error { return nil }); err == nil {
		t.Fatal("nil client StreamCompletion() error = nil")
	}
	if _, err := (&OpenAIClient{}).StreamCompletion(context.Background(), validRequest, func(string) error { return nil }); err == nil {
		t.Fatal("nil HTTP client StreamCompletion() error = nil")
	}

	testCases := []struct {
		name   string
		mutate func(request *openAIStreamRequest)
	}{
		{name: "base URL", mutate: func(request *openAIStreamRequest) { request.BaseURL = "" }},
		{name: "model", mutate: func(request *openAIStreamRequest) { request.Model = " " }},
		{name: "messages", mutate: func(request *openAIStreamRequest) { request.Messages = nil }},
		{name: "max tokens", mutate: func(request *openAIStreamRequest) { request.MaxTokens = 0 }},
		{name: "encode", mutate: func(request *openAIStreamRequest) { request.Temperature = math.NaN() }},
	}
	client := newOpenAIClientWithHTTPClient(&http.Client{})
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			request := validRequest
			testCase.mutate(&request)
			if _, err := client.StreamCompletion(context.Background(), request, func(string) error { return nil }); err == nil {
				t.Fatal("StreamCompletion() error = nil")
			}
		})
	}
}

// TestOpenAIClientNetworkAndCancellationErrors 验证 HTTP Transport 错误保留取消语义
func TestOpenAIClientNetworkAndCancellationErrors(t *testing.T) {
	t.Parallel()

	request := openAIStreamRequest{
		BaseURL:     "http://provider.example/v1",
		Model:       "model",
		Messages:    []OpenAIMessageDTO{{Role: openAIRoleUser, Content: "prompt"}},
		Temperature: 0.7,
		MaxTokens:   10,
	}
	networkClient := newOpenAIClientWithHTTPClient(&http.Client{Transport: roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("network down")
	})})
	if _, err := networkClient.StreamCompletion(context.Background(), request, func(string) error { return nil }); err == nil || !strings.Contains(err.Error(), "send OpenAI request") {
		t.Fatalf("network error = %v", err)
	}

	cancelledContext, cancel := context.WithCancel(context.Background())
	cancel()
	cancelledClient := newOpenAIClientWithHTTPClient(&http.Client{Transport: roundTripperFunc(func(httpRequest *http.Request) (*http.Response, error) {
		return nil, httpRequest.Context().Err()
	})})
	if _, err := cancelledClient.StreamCompletion(cancelledContext, request, func(string) error { return nil }); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled error = %v, want context.Canceled", err)
	}
}

// TestConsumeOpenAIEventStreamErrors 验证 SSE 解码 回调 阅读错误和无 DONE EOF 结算
func TestConsumeOpenAIEventStreamErrors(t *testing.T) {
	t.Parallel()

	if _, err := consumeOpenAIEventStream(strings.NewReader("data: {bad}\n"), func(string) error { return nil }); err == nil || !strings.Contains(err.Error(), "decode OpenAI stream chunk") {
		t.Fatalf("malformed SSE error = %v", err)
	}
	callbackError := errors.New("consumer failed")
	if _, err := consumeOpenAIEventStream(
		strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"chunk\"},\"finish_reason\":null}]}\n"),
		func(string) error { return callbackError },
	); err == nil || !strings.Contains(err.Error(), "handle OpenAI stream chunk") {
		t.Fatalf("callback SSE error = %v", err)
	}
	if _, err := consumeOpenAIEventStream(failingReader{err: errors.New("read failed")}, func(string) error { return nil }); err == nil || !strings.Contains(err.Error(), "read OpenAI event stream") {
		t.Fatalf("reader SSE error = %v", err)
	}

	result, err := consumeOpenAIEventStream(
		strings.NewReader("event: message\ndata: {\"choices\":[{\"delta\":{\"content\":\"\"},\"finish_reason\":\"length\"}]}\n"),
		func(string) error { return nil },
	)
	if err != nil || result.FinishReason != "length" {
		t.Fatalf("EOF stream result = %#v, error = %v", result, err)
	}
}

// TestDecodeOpenAIHTTPErrorFallbacks 验证结构化 原始 空正文与读取失败的错误消息策略
func TestDecodeOpenAIHTTPErrorFallbacks(t *testing.T) {
	t.Parallel()

	structured := decodeOpenAIHTTPError(&http.Response{
		StatusCode: http.StatusBadRequest,
		Status:     "400 Bad Request",
		Body:       io.NopCloser(strings.NewReader(`{"error":{"message":"structured"}}`)),
	})
	if !strings.Contains(structured.Error(), "structured") {
		t.Fatalf("structured error = %v", structured)
	}
	raw := decodeOpenAIHTTPError(&http.Response{
		StatusCode: http.StatusBadGateway,
		Status:     "502 Bad Gateway",
		Body:       io.NopCloser(strings.NewReader("raw body")),
	})
	if !strings.Contains(raw.Error(), "raw body") {
		t.Fatalf("raw error = %v", raw)
	}
	empty := decodeOpenAIHTTPError(&http.Response{
		StatusCode: http.StatusServiceUnavailable,
		Status:     "503 Service Unavailable",
		Body:       io.NopCloser(strings.NewReader("")),
	})
	if !strings.Contains(empty.Error(), "503 Service Unavailable") {
		t.Fatalf("empty error = %v", empty)
	}
	readFailure := decodeOpenAIHTTPError(&http.Response{
		StatusCode: http.StatusInternalServerError,
		Body:       io.NopCloser(failingReader{err: errors.New("read failed")}),
	})
	if !strings.Contains(readFailure.Error(), "read OpenAI error response") {
		t.Fatalf("read failure = %v", readFailure)
	}
}

// TestOpenAIClientResponseCloseErrors 验证成功流和 Provider 错误都不会吞掉 Body.Close 失败
func TestOpenAIClientResponseCloseErrors(t *testing.T) {
	t.Parallel()

	request := openAIStreamRequest{
		BaseURL:     "http://provider.example/v1",
		Model:       "model",
		Messages:    []OpenAIMessageDTO{{Role: openAIRoleUser, Content: "prompt"}},
		Temperature: 0.7,
		MaxTokens:   10,
	}
	for _, statusCode := range []int{http.StatusOK, http.StatusBadRequest} {
		client := newOpenAIClientWithHTTPClient(&http.Client{Transport: roundTripperFunc(func(*http.Request) (*http.Response, error) {
			bodyContent := "data: [DONE]\n\n"
			if statusCode != http.StatusOK {
				bodyContent = `{"error":{"message":"bad request"}}`
			}
			return &http.Response{
				StatusCode: statusCode,
				Status:     fmt.Sprintf("%d status", statusCode),
				Body: &errorReadCloser{
					Reader:   strings.NewReader(bodyContent),
					closeErr: errors.New("close failed"),
				},
			}, nil
		})})
		if _, err := client.StreamCompletion(context.Background(), request, func(string) error { return nil }); err == nil || !strings.Contains(err.Error(), "response body") {
			t.Fatalf("status %d close error = %v", statusCode, err)
		}
	}
}

type failingReader struct {
	err error
}

func (reader failingReader) Read([]byte) (int, error) {
	return 0, reader.err
}

type errorReadCloser struct {
	*strings.Reader
	closeErr error
}

func (closer *errorReadCloser) Close() error {
	return closer.closeErr
}
