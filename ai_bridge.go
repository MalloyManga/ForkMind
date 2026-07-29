package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
)

const (
	aiEventChunk = "forkmind:ai:chunk"
	aiEventDone  = "forkmind:ai:done"
	aiEventError = "forkmind:ai:error"
)

// StartChatCompletionInput 是 React 点击 Send 时提交给 Wails 的完整请求
// Thread 是当前会话快照 Config 是本轮 OpenAI-compatible 设置 APIKey 不会持久化
type StartChatCompletionInput struct {
	RequestID    string                    `json:"requestId"`
	Thread       ConversationThreadDTO     `json:"thread"`
	ActiveNodeID string                    `json:"activeNodeId"`
	Config       OpenAICompletionConfigDTO `json:"config"`
}

// CancelChatCompletionInput 标识需要取消的流式请求
type CancelChatCompletionInput struct {
	RequestID string `json:"requestId"`
}

// AIStreamChunkEvent 是 Go 每收到一段 delta.content 发给 React 的事件
type AIStreamChunkEvent struct {
	RequestID string `json:"requestId"`
	NodeID    string `json:"nodeId"`
	Delta     string `json:"delta"`
}

// AIStreamDoneEvent 表示请求正常完成或被用户取消
type AIStreamDoneEvent struct {
	RequestID    string `json:"requestId"`
	NodeID       string `json:"nodeId"`
	FinishReason string `json:"finishReason"`
	Cancelled    bool   `json:"cancelled"`
}

// AIStreamErrorEvent 表示异步请求在启动后发生错误
type AIStreamErrorEvent struct {
	RequestID string      `json:"requestId"`
	NodeID    string      `json:"nodeId"`
	Error     BridgeError `json:"error"`
}

// AIRequestManager 保存正在运行的 requestId 与 cancel 函数
// mutex 保护 Wails UI 线程 Cancel 调用和后台 HTTP goroutine 的并发访问
type AIRequestManager struct {
	mutex   sync.Mutex
	cancels map[string]context.CancelFunc
}

// NewAIRequestManager 创建空请求注册表
func NewAIRequestManager() *AIRequestManager {
	return &AIRequestManager{cancels: make(map[string]context.CancelFunc)}
}

// Register 注册新请求
// requestID 来自前端生成的稳定 id 重复 id 会返回错误避免事件串线
func (manager *AIRequestManager) Register(requestID string, cancel context.CancelFunc) error {
	manager.mutex.Lock()
	defer manager.mutex.Unlock()

	if _, exists := manager.cancels[requestID]; exists {
		return fmt.Errorf("request %q is already running", requestID)
	}
	manager.cancels[requestID] = cancel
	return nil
}

// Cancel 取消指定请求
// 返回 false 表示请求已经结束或 requestId 不存在
func (manager *AIRequestManager) Cancel(requestID string) bool {
	manager.mutex.Lock()
	cancel, exists := manager.cancels[requestID]
	manager.mutex.Unlock()
	if !exists {
		return false
	}

	cancel()
	return true
}

// Complete 从注册表移除已经结算的请求
func (manager *AIRequestManager) Complete(requestID string) {
	manager.mutex.Lock()
	delete(manager.cancels, requestID)
	manager.mutex.Unlock()
}

// StartChatCompletion 校验上下文并启动后台 OpenAI SSE 请求
// 返回成功只表示请求已经启动 后续 chunk done error 通过 Wails Events 发送
func (a *App) StartChatCompletion(input StartChatCompletionInput) OperationResponse {
	if strings.TrimSpace(input.RequestID) == "" {
		return OperationResponse{Error: newBridgeError(errorCodeInvalidData, fmt.Errorf("requestId cannot be empty"), false)}
	}
	if a.ctx == nil {
		return OperationResponse{Error: newBridgeError(errorCodeInternal, fmt.Errorf("Wails application context is unavailable"), true)}
	}
	if a.openAIClient == nil || a.aiRequestManager == nil {
		return OperationResponse{Error: newBridgeError(errorCodeInternal, fmt.Errorf("AI runtime is unavailable"), true)}
	}

	runtimeContext, err := BuildAIRuntimeContext(BuildAIContextInput{
		Thread:       input.Thread,
		ActiveNodeID: input.ActiveNodeID,
		SystemPrompt: input.Config.SystemPrompt,
	})
	if err != nil {
		return OperationResponse{Error: newBridgeError(errorCodeInvalidData, err, false)}
	}

	requestContext, cancel := context.WithCancel(a.ctx)
	if err := a.aiRequestManager.Register(input.RequestID, cancel); err != nil {
		cancel()
		return OperationResponse{Error: newBridgeError(errorCodeInvalidData, err, false)}
	}

	go a.runChatCompletion(requestContext, input, runtimeContext)
	return OperationResponse{}
}

// CancelChatCompletion 取消仍在运行的 OpenAI 请求
// requestId 不存在时返回 not_found 便于前端区分已经结束和取消失败
func (a *App) CancelChatCompletion(input CancelChatCompletionInput) OperationResponse {
	if strings.TrimSpace(input.RequestID) == "" {
		return OperationResponse{Error: newBridgeError(errorCodeInvalidData, fmt.Errorf("requestId cannot be empty"), false)}
	}
	if a.aiRequestManager == nil {
		return OperationResponse{Error: newBridgeError(errorCodeInternal, fmt.Errorf("AI request manager is unavailable"), true)}
	}
	if !a.aiRequestManager.Cancel(input.RequestID) {
		return OperationResponse{Error: newBridgeError(errorCodeNotFound, fmt.Errorf("request %q is not running", input.RequestID), false)}
	}

	return OperationResponse{}
}

// runChatCompletion 在后台 goroutine 中执行 HTTP 流并转发 Wails Events
// requestContext 被 CancelChatCompletion 取消时发送 cancelled done 而不是 error
func (a *App) runChatCompletion(
	requestContext context.Context,
	input StartChatCompletionInput,
	runtimeContext AIRuntimeContextDTO,
) {
	defer a.aiRequestManager.Complete(input.RequestID)

	result, err := a.openAIClient.StreamCompletion(
		requestContext,
		openAIStreamRequest{
			BaseURL:     input.Config.BaseURL,
			APIKey:      input.Config.APIKey,
			Model:       input.Config.Model,
			Messages:    runtimeContext.Messages,
			Temperature: input.Config.Temperature,
			MaxTokens:   input.Config.MaxTokens,
		},
		func(content string) error {
			emitWailsEvent(a.ctx, aiEventChunk, AIStreamChunkEvent{
				RequestID: input.RequestID,
				NodeID:    input.ActiveNodeID,
				Delta:     content,
			})
			return nil
		},
	)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			emitWailsEvent(a.ctx, aiEventDone, AIStreamDoneEvent{
				RequestID:    input.RequestID,
				NodeID:       input.ActiveNodeID,
				FinishReason: "cancelled",
				Cancelled:    true,
			})
			return
		}

		bridgeError := classifyOpenAIError(err)
		emitWailsEvent(a.ctx, aiEventError, AIStreamErrorEvent{
			RequestID: input.RequestID,
			NodeID:    input.ActiveNodeID,
			Error:     *bridgeError,
		})
		return
	}

	emitWailsEvent(a.ctx, aiEventDone, AIStreamDoneEvent{
		RequestID:    input.RequestID,
		NodeID:       input.ActiveNodeID,
		FinishReason: result.FinishReason,
		Cancelled:    false,
	})
}

// classifyOpenAIError 把 Provider 网络与 HTTP 错误转换为稳定前端错误码
func classifyOpenAIError(err error) *BridgeError {
	var httpError *OpenAIHTTPError
	if errors.As(err, &httpError) {
		switch httpError.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return newBridgeError("provider_auth_failed", err, false)
		case http.StatusTooManyRequests:
			return newBridgeError("provider_rate_limited", err, true)
		default:
			return newBridgeError("provider_http_error", err, httpError.StatusCode >= http.StatusInternalServerError)
		}
	}

	return newBridgeError(errorCodeRequestFailed, err, true)
}
