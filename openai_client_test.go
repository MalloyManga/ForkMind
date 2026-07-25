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
