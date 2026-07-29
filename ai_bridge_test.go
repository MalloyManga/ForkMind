package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestAIRequestManagerLifecycle 验证同 requestId 不能重复注册且完成后可再次使用
func TestAIRequestManagerLifecycle(t *testing.T) {
	t.Parallel()

	manager := NewAIRequestManager()
	cancelCalled := false
	firstCancel := func() { cancelCalled = true }
	if err := manager.Register("request-1", firstCancel); err != nil {
		t.Fatalf("first Register() error = %v", err)
	}
	_, duplicateCancel := context.WithCancel(context.Background())
	if err := manager.Register("request-1", duplicateCancel); err == nil {
		t.Fatal("duplicate Register() error = nil, want duplicate error")
	}
	if !manager.Cancel("request-1") {
		t.Fatal("Cancel() = false, want true")
	}
	if !cancelCalled {
		t.Fatal("Cancel() did not invoke the registered cancel function")
	}
	manager.Complete("request-1")
	if manager.Cancel("request-1") {
		t.Fatal("Cancel() after Complete = true, want false")
	}
}

// TestCancelChatCompletionScenarios 验证取消入口的字段校验 运行时缺失 未找到与成功路径
func TestCancelChatCompletionScenarios(t *testing.T) {
	t.Parallel()

	if response := (&App{}).CancelChatCompletion(CancelChatCompletionInput{}); response.Error == nil || response.Error.Code != errorCodeInvalidData {
		t.Fatalf("empty CancelChatCompletion() = %#v", response)
	}
	if response := (&App{}).CancelChatCompletion(CancelChatCompletionInput{RequestID: "request"}); response.Error == nil || response.Error.Code != errorCodeInternal {
		t.Fatalf("missing manager CancelChatCompletion() = %#v", response)
	}

	manager := NewAIRequestManager()
	app := &App{aiRequestManager: manager}
	if response := app.CancelChatCompletion(CancelChatCompletionInput{RequestID: "missing"}); response.Error == nil || response.Error.Code != errorCodeNotFound {
		t.Fatalf("missing request CancelChatCompletion() = %#v", response)
	}

	cancelCalled := false
	if err := manager.Register("running", func() { cancelCalled = true }); err != nil {
		t.Fatalf("register running request: %v", err)
	}
	if response := app.CancelChatCompletion(CancelChatCompletionInput{RequestID: "running"}); response.Error != nil {
		t.Fatalf("successful CancelChatCompletion() = %#v", response)
	}
	if !cancelCalled {
		t.Fatal("CancelChatCompletion() did not cancel request")
	}
}

// TestClassifyOpenAIError 验证认证和限流错误映射为稳定错误码
func TestClassifyOpenAIError(t *testing.T) {
	t.Parallel()

	authError := classifyOpenAIError(&OpenAIHTTPError{StatusCode: http.StatusUnauthorized, Message: "bad key"})
	if authError.Code != "provider_auth_failed" || authError.Retryable {
		t.Fatalf("auth error = %#v, want non-retryable provider_auth_failed", authError)
	}

	rateLimitError := classifyOpenAIError(&OpenAIHTTPError{StatusCode: http.StatusTooManyRequests, Message: "slow down"})
	if rateLimitError.Code != "provider_rate_limited" || !rateLimitError.Retryable {
		t.Fatalf("rate limit error = %#v, want retryable provider_rate_limited", rateLimitError)
	}
	for _, testCase := range []struct {
		statusCode int
		code       string
		retryable  bool
	}{
		{statusCode: http.StatusForbidden, code: "provider_auth_failed", retryable: false},
		{statusCode: http.StatusInternalServerError, code: "provider_http_error", retryable: true},
		{statusCode: http.StatusBadRequest, code: "provider_http_error", retryable: false},
	} {
		classified := classifyOpenAIError(&OpenAIHTTPError{StatusCode: testCase.statusCode, Message: "provider"})
		if classified.Code != testCase.code || classified.Retryable != testCase.retryable {
			t.Fatalf("classify status %d = %#v", testCase.statusCode, classified)
		}
	}
	genericError := classifyOpenAIError(fmt.Errorf("network down"))
	if genericError.Code != errorCodeRequestFailed || !genericError.Retryable {
		t.Fatalf("generic error = %#v", genericError)
	}
}

// TestStartChatCompletionValidation 验证启动入口在请求字段和运行时依赖异常时拒绝请求
func TestStartChatCompletionValidation(t *testing.T) {
	t.Parallel()

	validInput := createAIStartInput("request-validation")
	if response := (&App{}).StartChatCompletion(validInput); response.Error == nil || response.Error.Code != errorCodeInternal {
		t.Fatalf("StartChatCompletion() without context = %#v", response)
	}
	if response := (&App{ctx: context.Background()}).StartChatCompletion(validInput); response.Error == nil || response.Error.Code != "internal_error" {
		t.Fatalf("StartChatCompletion() without runtime = %#v", response)
	}
	invalidInput := validInput
	invalidInput.RequestID = ""
	if response := (&App{ctx: context.Background()}).StartChatCompletion(invalidInput); response.Error == nil || response.Error.Code != errorCodeInvalidData {
		t.Fatalf("empty requestId response = %#v", response)
	}

	app := &App{
		ctx:              context.Background(),
		openAIClient:     newOpenAIClientWithHTTPClient(&http.Client{}),
		aiRequestManager: NewAIRequestManager(),
	}
	invalidInput = validInput
	invalidInput.ActiveNodeID = "missing-node"
	if response := app.StartChatCompletion(invalidInput); response.Error == nil || response.Error.Code != errorCodeInvalidData {
		t.Fatalf("invalid context response = %#v", response)
	}

	_, cancel := context.WithCancel(context.Background())
	if err := app.aiRequestManager.Register(validInput.RequestID, cancel); err != nil {
		t.Fatalf("register duplicate fixture: %v", err)
	}
	if response := app.StartChatCompletion(validInput); response.Error == nil || response.Error.Code != errorCodeInvalidData {
		t.Fatalf("duplicate request response = %#v", response)
	}
}

// TestStartAndRunChatCompletionEvents 验证成功 SSE 请求会发出 chunk 与 done 事件并清理注册表
func TestStartAndRunChatCompletionEvents(t *testing.T) {
	previousEmitter := emitWailsEvent
	defer func() { emitWailsEvent = previousEmitter }()

	events := make(chan eventRecord, 4)
	emitWailsEvent = func(_ context.Context, name string, payload ...interface{}) {
		if len(payload) > 0 {
			events <- eventRecord{name: name, payload: payload[0]}
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		var requestBody openAIChatCompletionsRequest
		if err := json.NewDecoder(request.Body).Decode(&requestBody); err != nil {
			t.Errorf("decode chat request: %v", err)
		}
		if requestBody.Model != "test-model" || requestBody.Temperature != defaultOpenAITemperature || requestBody.MaxTokens != defaultOpenAIMaxTokens {
			t.Errorf("chat defaults = %#v", requestBody)
		}
		responseWriter.Header().Set("Content-Type", "text/event-stream")
		_, _ = responseWriter.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"))
	}))
	defer server.Close()

	app := &App{
		ctx:              context.Background(),
		openAIClient:     newOpenAIClientWithHTTPClient(server.Client()),
		aiRequestManager: NewAIRequestManager(),
	}
	input := createAIStartInput("request-success")
	input.Config.BaseURL = server.URL + "/v1"
	if response := app.StartChatCompletion(input); response.Error != nil {
		t.Fatalf("StartChatCompletion() = %#v", response)
	}

	chunkEvent := <-events
	doneEvent := <-events
	if chunkEvent.name != aiEventChunk || doneEvent.name != aiEventDone {
		t.Fatalf("events = %#v, %#v", chunkEvent, doneEvent)
	}
	if chunk, ok := chunkEvent.payload.(AIStreamChunkEvent); !ok || chunk.Delta != "ok" {
		t.Fatalf("chunk payload = %#v", chunkEvent.payload)
	}
	if done, ok := doneEvent.payload.(AIStreamDoneEvent); !ok || done.FinishReason != "stop" || done.Cancelled {
		t.Fatalf("done payload = %#v", doneEvent.payload)
	}
	if app.aiRequestManager.Cancel(input.RequestID) {
		t.Fatal("request remains registered after completion")
	}
}

// TestRunChatCompletionCancellationAndProviderError 验证取消与 Provider 错误分别走 done 和 error 事件
func TestRunChatCompletionCancellationAndProviderError(t *testing.T) {
	previousEmitter := emitWailsEvent
	defer func() { emitWailsEvent = previousEmitter }()

	for _, testCase := range []struct {
		name       string
		client     *http.Client
		wantEvent  string
		wantCancel bool
	}{
		{
			name: "cancelled",
			client: &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
				return nil, request.Context().Err()
			})},
			wantEvent:  aiEventDone,
			wantCancel: true,
		},
		{
			name: "provider error",
			client: &http.Client{Transport: roundTripperFunc(func(_ *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusBadGateway,
					Status:     "502 Bad Gateway",
					Body:       ioNopCloser{Reader: strings.NewReader(`{"error":{"message":"upstream"}}`)},
				}, nil
			})},
			wantEvent:  aiEventError,
			wantCancel: false,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			event := make(chan eventRecord, 1)
			emitWailsEvent = func(_ context.Context, name string, payload ...interface{}) {
				if len(payload) > 0 {
					event <- eventRecord{name: name, payload: payload[0]}
				}
			}
			requestContext, cancel := context.WithCancel(context.Background())
			defer cancel()
			if testCase.wantCancel {
				cancel()
			}
			requestID := "request-" + testCase.name
			manager := NewAIRequestManager()
			_, managerCancel := context.WithCancel(context.Background())
			if err := manager.Register(requestID, managerCancel); err != nil {
				t.Fatalf("register request: %v", err)
			}
			app := &App{ctx: context.Background(), openAIClient: newOpenAIClientWithHTTPClient(testCase.client), aiRequestManager: manager}
			app.runChatCompletion(requestContext, createAIStartInput(requestID), AIRuntimeContextDTO{Messages: []OpenAIMessageDTO{{Role: openAIRoleUser, Content: "prompt"}}})
			select {
			case receivedEvent := <-event:
				if receivedEvent.name != testCase.wantEvent {
					t.Fatalf("event = %#v, want %q", receivedEvent, testCase.wantEvent)
				}
			case <-time.After(time.Second):
				t.Fatal("timed out waiting for completion event")
			}
			if manager.Cancel(requestID) {
				t.Fatal("request remains registered after runChatCompletion")
			}
		})
	}
}

// createAIStartInput 返回启动请求测试使用的合法 chat 上下文
func createAIStartInput(requestID string) StartChatCompletionInput {
	return StartChatCompletionInput{
		RequestID:    requestID,
		Thread:       createContextTestThread(),
		ActiveNodeID: "child-chat",
		Config: OpenAICompletionConfigDTO{
			BaseURL: "http://localhost:11434/v1",
			APIKey:  "test-key",
			Model:   "test-model",
		},
	}
}

type eventRecord struct {
	name    string
	payload interface{}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (roundTripper roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTripper(request)
}

type ioNopCloser struct {
	*strings.Reader
}

func (closer ioNopCloser) Close() error { return nil }
