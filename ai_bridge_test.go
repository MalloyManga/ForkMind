package main

import (
	"context"
	"net/http"
	"testing"
)

// TestAIRequestManagerLifecycle 验证同 requestId 不能重复注册且完成后可再次使用
func TestAIRequestManagerLifecycle(t *testing.T) {
	t.Parallel()

	manager := NewAIRequestManager()
	_, firstCancel := context.WithCancel(context.Background())
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
	manager.Complete("request-1")
	if manager.Cancel("request-1") {
		t.Fatal("Cancel() after Complete = true, want false")
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
}
