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
	aiEventChunk      = "forkmind:ai:chunk"
	aiEventDone       = "forkmind:ai:done"
	aiEventError      = "forkmind:ai:error"
	aiEventCanvasPlan = "forkmind:ai:canvas-plan"
)

// StartChatCompletionInput 是 React 点击 Send 时提交给 Wails 的完整请求
// Thread 是当前会话快照 Config 是本轮 OpenAI-compatible 设置 APIKey 不会持久化
type StartChatCompletionInput struct {
	RequestID      string                    `json:"requestId"`
	Thread         ConversationThreadDTO     `json:"thread"`
	ActiveNodeID   string                    `json:"activeNodeId"`
	Config         OpenAICompletionConfigDTO `json:"config"`
	AllowWebSearch bool                      `json:"allowWebSearch"`
}

// CancelChatCompletionInput 标识需要取消的流式请求
type CancelChatCompletionInput struct {
	RequestID string `json:"requestId"`
}

// ListOpenAIModelsInput 是模型发现请求使用的临时连接配置
// APIKey 只在本次 Wails 调用和 Go 内存中存在 不会进入工作区持久化
type ListOpenAIModelsInput struct {
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
}

// ListOpenAIModelsResponse 返回 Provider 当前公开的模型 ID 列表
type ListOpenAIModelsResponse struct {
	Models []string     `json:"models"`
	Error  *BridgeError `json:"error,omitempty"`
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

// AICanvasPlanEvent 把 Go 已校验的模型提案送往 React 等待用户接受或拒绝
type AICanvasPlanEvent struct {
	RequestID     string        `json:"requestId"`
	NodeID        string        `json:"nodeId"`
	SchemaVersion int           `json:"schemaVersion"`
	Plan          CanvasPlanDTO `json:"plan"`
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

	hydratedThread, err := HydrateAIFileReferences(
		input.Thread,
		input.ActiveNodeID,
		func(asset ManagedAssetDTO) (string, error) {
			if a.workspaceRepository == nil {
				return "", fmt.Errorf("workspace repository is unavailable")
			}
			content, detectedMimeType, readErr := a.workspaceRepository.ReadManagedAsset(asset.ID)
			if readErr != nil {
				return "", readErr
			}
			return ExtractManagedAssetText(asset, content, detectedMimeType)
		},
	)
	if err != nil {
		return OperationResponse{Error: newBridgeError(errorCodeInvalidData, err, false)}
	}
	input.Thread = hydratedThread

	runtimeContext, err := BuildAIRuntimeContext(BuildAIContextInput{
		Thread:       hydratedThread,
		ActiveNodeID: input.ActiveNodeID,
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

// ListOpenAIModels 通过当前 OpenAI-compatible Provider 的 /models 端点发现模型
// input 来自 AI Connection 尚未保存的 Base URL 和 API Key
// 返回值为空数组表示 Provider 合法响应但没有公开模型 Error 表示网络 协议或鉴权失败
// 用户打开模型选择或主动刷新时触发 不会修改 AISettingsStore
func (a *App) ListOpenAIModels(input ListOpenAIModelsInput) ListOpenAIModelsResponse {
	if a.openAIClient == nil {
		return ListOpenAIModelsResponse{Error: newBridgeError(errorCodeInternal, fmt.Errorf("AI runtime is unavailable"), true)}
	}

	models, err := a.openAIClient.ListModels(context.Background(), input.BaseURL, input.APIKey)
	if err != nil {
		return ListOpenAIModelsResponse{Error: classifyOpenAIError(err)}
	}
	return ListOpenAIModelsResponse{Models: models}
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
	if a.urlContentFetcher != nil {
		hydratedThread, hydrateErr := hydrateReferencedLinkContent(
			requestContext,
			input.Thread,
			input.ActiveNodeID,
			a.urlContentFetcher,
		)
		if hydrateErr != nil {
			if errors.Is(hydrateErr, context.Canceled) {
				emitWailsEvent(a.ctx, aiEventDone, AIStreamDoneEvent{
					RequestID:    input.RequestID,
					NodeID:       input.ActiveNodeID,
					FinishReason: "cancelled",
					Cancelled:    true,
				})
				return
			}
			emitWailsEvent(a.ctx, aiEventError, AIStreamErrorEvent{
				RequestID: input.RequestID,
				NodeID:    input.ActiveNodeID,
				Error:     *newBridgeError(errorCodeRequestFailed, hydrateErr, true),
			})
			return
		}
		hydratedContext, contextErr := BuildAIRuntimeContext(BuildAIContextInput{
			Thread:       hydratedThread,
			ActiveNodeID: input.ActiveNodeID,
		})
		if contextErr != nil {
			emitWailsEvent(a.ctx, aiEventError, AIStreamErrorEvent{
				RequestID: input.RequestID,
				NodeID:    input.ActiveNodeID,
				Error:     *newBridgeError(errorCodeInvalidData, contextErr, false),
			})
			return
		}
		runtimeContext = hydratedContext
	}
	runtimeContext, err := AttachAIReferenceImages(
		runtimeContext,
		input.Thread,
		input.ActiveNodeID,
		func(asset ManagedAssetDTO) ([]byte, string, error) {
			if a.workspaceRepository == nil {
				return nil, "", fmt.Errorf("workspace repository is unavailable")
			}
			return a.workspaceRepository.ReadManagedAsset(asset.ID)
		},
	)
	if err != nil {
		emitWailsEvent(a.ctx, aiEventError, AIStreamErrorEvent{
			RequestID: input.RequestID,
			NodeID:    input.ActiveNodeID,
			Error:     *newBridgeError(errorCodeInvalidData, err, false),
		})
		return
	}

	streamRequest := openAIStreamRequest{
		BaseURL:     input.Config.BaseURL,
		APIKey:      input.Config.APIKey,
		Model:       input.Config.Model,
		Messages:    runtimeContext.Messages,
		Temperature: defaultOpenAITemperature,
		MaxTokens:   defaultOpenAIMaxTokens,
		Tools:       []openAIToolDefinition{canvasPlanToolDefinition()},
	}
	onChunk := func(content string) error {
		emitWailsEvent(a.ctx, aiEventChunk, AIStreamChunkEvent{
			RequestID: input.RequestID,
			NodeID:    input.ActiveNodeID,
			Delta:     content,
		})
		return nil
	}

	var result OpenAIStreamResult
	if input.AllowWebSearch {
		result, err = a.openAIClient.StreamNativeWebSearch(requestContext, streamRequest, onChunk)
	} else {
		result, err = a.openAIClient.StreamCompletion(requestContext, streamRequest, onChunk)
	}
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
		if input.AllowWebSearch {
			err = fmt.Errorf("native web search is unavailable for the current model or Provider: %w", err)
		}

		bridgeError := classifyOpenAIError(err)
		emitWailsEvent(a.ctx, aiEventError, AIStreamErrorEvent{
			RequestID: input.RequestID,
			NodeID:    input.ActiveNodeID,
			Error:     *bridgeError,
		})
		return
	}
	if len(result.ToolCalls) > 1 {
		emitWailsEvent(a.ctx, aiEventError, AIStreamErrorEvent{
			RequestID: input.RequestID,
			NodeID:    input.ActiveNodeID,
			Error:     *newBridgeError(errorCodeInvalidData, fmt.Errorf("AI returned %d tool calls only one canvas plan is allowed", len(result.ToolCalls)), false),
		})
		return
	}
	if len(result.ToolCalls) == 1 {
		plan, planErr := parseCanvasPlanToolCall(result.ToolCalls[0])
		if planErr != nil {
			emitWailsEvent(a.ctx, aiEventError, AIStreamErrorEvent{
				RequestID: input.RequestID,
				NodeID:    input.ActiveNodeID,
				Error:     *newBridgeError(errorCodeInvalidData, planErr, false),
			})
			return
		}
		emitWailsEvent(a.ctx, aiEventCanvasPlan, AICanvasPlanEvent{
			RequestID:     input.RequestID,
			NodeID:        input.ActiveNodeID,
			SchemaVersion: canvasPlanSchemaVersion,
			Plan:          plan,
		})
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
