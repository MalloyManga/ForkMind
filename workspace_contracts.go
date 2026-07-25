package main

import (
	"fmt"
	"math"
	"time"
)

const (
	workspaceFormat        = "forkmind-workspace"
	workspaceVersion       = "1.0.0"
	threadFileFormat       = "forkmind-thread"
	errorCodeInternal      = "internal_error"
	errorCodeInvalidData   = "invalid_data"
	errorCodeNotFound      = "not_found"
	errorCodeReadFailed    = "read_failed"
	errorCodeWriteFailed   = "write_failed"
	errorCodeRequestFailed = "request_failed"
)

// BridgeError 是所有 Wails Bridge 方法共用的错误协议
// Code 供 React 做稳定分支判断 Message 供用户阅读 Retryable 表示是否适合直接重试
type BridgeError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

// OperationResponse 表示不需要返回业务数据的 Bridge 操作结果
// Error 为 nil 表示操作成功 非 nil 时前端必须展示或记录明确错误
type OperationResponse struct {
	Error *BridgeError `json:"error,omitempty"`
}

// WorkspaceLoadResponse 是 LoadWorkspace 的返回协议
// Exists 为 false 表示用户首次启动且本地还没有工作区文件 这不是错误
type WorkspaceLoadResponse struct {
	Exists    bool                  `json:"exists"`
	Workspace *WorkspaceDocumentDTO `json:"workspace,omitempty"`
	Error     *BridgeError          `json:"error,omitempty"`
}

// DataDirectoryResponse 返回 ForkMind 实际使用的数据目录
// 该路径只用于设置页提示和问题排查 React 不应自行绕过 Go 写文件
type DataDirectoryResponse struct {
	Path  string       `json:"path"`
	Error *BridgeError `json:"error,omitempty"`
}

// WorkspaceExportResponse 返回系统保存对话框与工作区导出的结果
// Cancelled=true 表示用户主动关闭对话框 该情况不是错误
type WorkspaceExportResponse struct {
	Cancelled bool         `json:"cancelled"`
	Path      string       `json:"path,omitempty"`
	Error     *BridgeError `json:"error,omitempty"`
}

// WorkspaceImportResponse 返回系统打开对话框读取到的原始 JSON 文本
// Content 必须继续由 React validateAndNormalizeWorkspace 校验后才能进入 Store
type WorkspaceImportResponse struct {
	Cancelled bool         `json:"cancelled"`
	Path      string       `json:"path,omitempty"`
	Content   string       `json:"content,omitempty"`
	Error     *BridgeError `json:"error,omitempty"`
}

// CardPositionDTO 对应 React ConversationCardPosition
type CardPositionDTO struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// CardSizeDTO 对应 React ConversationCardSize
type CardSizeDTO struct {
	Mode      string  `json:"mode"`
	Width     float64 `json:"width"`
	MinHeight float64 `json:"minHeight"`
}

// ConversationCardDTO 是 chat note 判别联合在 Go Bridge 中的扁平表示
// CardType 决定 UserPrompt AIResponse NoteContent 中哪些字段具有业务意义
type ConversationCardDTO struct {
	ID               string          `json:"id"`
	CardType         string          `json:"cardType"`
	ParentID         *string         `json:"parentId"`
	ReferenceNodeIDs []string        `json:"referenceNodeIds,omitempty"`
	Position         CardPositionDTO `json:"position"`
	Size             CardSizeDTO     `json:"size"`
	Status           string          `json:"status"`
	CreatedAt        string          `json:"createdAt"`
	UpdatedAt        string          `json:"updatedAt"`
	UserPrompt       string          `json:"userPrompt,omitempty"`
	AIResponse       string          `json:"aiResponse,omitempty"`
	NoteContent      string          `json:"noteContent,omitempty"`
}

// ConversationThreadDTO 对应 React ConversationThread
// Cards 是一个会话内完整且可独立保存的业务事务边界
type ConversationThreadDTO struct {
	ID        string                `json:"id"`
	Title     string                `json:"title"`
	Cards     []ConversationCardDTO `json:"cards"`
	CreatedAt string                `json:"createdAt"`
	UpdatedAt string                `json:"updatedAt"`
}

// PersistedOpenAISettingsDTO 是允许写入本地 JSON 的 OpenAI-compatible 设置
// API Key 不在该结构中 因此不会通过工作区自动保存落盘
type PersistedOpenAISettingsDTO struct {
	BaseURL      string  `json:"baseUrl"`
	Model        string  `json:"model"`
	SystemPrompt string  `json:"systemPrompt"`
	Temperature  float64 `json:"temperature"`
	MaxTokens    int     `json:"maxTokens"`
}

// WorkspaceDocumentDTO 是 React 与 Go 之间传输的完整工作区快照
// Repository 会在磁盘上把它拆成轻量 index 与多个 thread 文件
type WorkspaceDocumentDTO struct {
	Format         string                     `json:"format"`
	Version        string                     `json:"version"`
	ActiveThreadID string                     `json:"activeThreadId"`
	Threads        []ConversationThreadDTO    `json:"threads"`
	Settings       PersistedOpenAISettingsDTO `json:"settings"`
	LastModified   string                     `json:"lastModified"`
}

// validateWorkspaceDocument 校验完整工作区领域约束
// document 来自 React SaveWorkspace 或磁盘 LoadWorkspace 解码结果
// 返回 nil 表示可以安全进入 Repository 或返回前端
func validateWorkspaceDocument(document WorkspaceDocumentDTO) error {
	if document.Format != workspaceFormat {
		return fmt.Errorf("format must be %q", workspaceFormat)
	}
	if document.Version != workspaceVersion {
		return fmt.Errorf("unsupported workspace version %q", document.Version)
	}
	if len(document.Threads) == 0 {
		return fmt.Errorf("workspace must contain at least one thread")
	}
	if _, err := time.Parse(time.RFC3339Nano, document.LastModified); err != nil {
		return fmt.Errorf("lastModified is invalid: %w", err)
	}
	if document.Settings.BaseURL == "" {
		return fmt.Errorf("settings.baseUrl cannot be empty")
	}
	if math.IsNaN(document.Settings.Temperature) || math.IsInf(document.Settings.Temperature, 0) {
		return fmt.Errorf("settings.temperature must be finite")
	}
	if document.Settings.Temperature < 0 || document.Settings.Temperature > 2 {
		return fmt.Errorf("settings.temperature must be between 0 and 2")
	}
	if document.Settings.MaxTokens <= 0 {
		return fmt.Errorf("settings.maxTokens must be positive")
	}

	threadByID := make(map[string]ConversationThreadDTO, len(document.Threads))
	for threadIndex, thread := range document.Threads {
		if _, exists := threadByID[thread.ID]; exists {
			return fmt.Errorf("threads[%d].id %q is duplicated", threadIndex, thread.ID)
		}
		if err := validateConversationThread(thread); err != nil {
			return fmt.Errorf("threads[%d]: %w", threadIndex, err)
		}
		threadByID[thread.ID] = thread
	}
	if _, exists := threadByID[document.ActiveThreadID]; !exists {
		return fmt.Errorf("activeThreadId %q does not exist", document.ActiveThreadID)
	}

	return nil
}

// validateConversationThread 校验单个会话节点集合和关系完整性
// thread 来自工作区保存或单独 thread 文件读取
// 返回错误时会带上具体节点索引和字段语义
func validateConversationThread(thread ConversationThreadDTO) error {
	if thread.ID == "" {
		return fmt.Errorf("id cannot be empty")
	}
	if thread.Title == "" {
		return fmt.Errorf("title cannot be empty")
	}
	if _, err := time.Parse(time.RFC3339Nano, thread.CreatedAt); err != nil {
		return fmt.Errorf("createdAt is invalid: %w", err)
	}
	if _, err := time.Parse(time.RFC3339Nano, thread.UpdatedAt); err != nil {
		return fmt.Errorf("updatedAt is invalid: %w", err)
	}

	cardByID := make(map[string]ConversationCardDTO, len(thread.Cards))
	for cardIndex, card := range thread.Cards {
		if card.ID == "" {
			return fmt.Errorf("cards[%d].id cannot be empty", cardIndex)
		}
		if _, exists := cardByID[card.ID]; exists {
			return fmt.Errorf("cards[%d].id %q is duplicated", cardIndex, card.ID)
		}
		if card.CardType != "chat" && card.CardType != "note" {
			return fmt.Errorf("cards[%d].cardType %q is invalid", cardIndex, card.CardType)
		}
		if !isValidNodeStatus(card.Status) {
			return fmt.Errorf("cards[%d].status %q is invalid", cardIndex, card.Status)
		}
		if !isFinite(card.Position.X) || !isFinite(card.Position.Y) {
			return fmt.Errorf("cards[%d].position must contain finite numbers", cardIndex)
		}
		if !isFinite(card.Size.Width) || !isFinite(card.Size.MinHeight) || card.Size.Width <= 0 || card.Size.MinHeight <= 0 {
			return fmt.Errorf("cards[%d].size must contain positive finite numbers", cardIndex)
		}
		if card.Size.Mode != "auto" && card.Size.Mode != "fixed" {
			return fmt.Errorf("cards[%d].size.mode %q is invalid", cardIndex, card.Size.Mode)
		}
		if _, err := time.Parse(time.RFC3339Nano, card.CreatedAt); err != nil {
			return fmt.Errorf("cards[%d].createdAt is invalid: %w", cardIndex, err)
		}
		if _, err := time.Parse(time.RFC3339Nano, card.UpdatedAt); err != nil {
			return fmt.Errorf("cards[%d].updatedAt is invalid: %w", cardIndex, err)
		}

		cardByID[card.ID] = card
	}

	for cardIndex, card := range thread.Cards {
		if card.ParentID != nil {
			if *card.ParentID == card.ID {
				return fmt.Errorf("cards[%d].parentId cannot reference itself", cardIndex)
			}
			if _, exists := cardByID[*card.ParentID]; !exists {
				return fmt.Errorf("cards[%d].parentId %q does not exist", cardIndex, *card.ParentID)
			}
		}

		referenceSet := make(map[string]struct{}, len(card.ReferenceNodeIDs))
		for _, referenceNodeID := range card.ReferenceNodeIDs {
			if referenceNodeID == card.ID {
				return fmt.Errorf("cards[%d].referenceNodeIds cannot reference itself", cardIndex)
			}
			if _, exists := cardByID[referenceNodeID]; !exists {
				return fmt.Errorf("cards[%d].referenceNodeId %q does not exist", cardIndex, referenceNodeID)
			}
			if _, duplicated := referenceSet[referenceNodeID]; duplicated {
				return fmt.Errorf("cards[%d].referenceNodeId %q is duplicated", cardIndex, referenceNodeID)
			}
			referenceSet[referenceNodeID] = struct{}{}
		}

		visited := map[string]struct{}{card.ID: {}}
		cursor := card.ParentID
		for cursor != nil {
			if _, cycleDetected := visited[*cursor]; cycleDetected {
				return fmt.Errorf("cards[%d].parentId creates a cycle", cardIndex)
			}
			visited[*cursor] = struct{}{}
			parentCard := cardByID[*cursor]
			cursor = parentCard.ParentID
		}
	}

	return nil
}

func isValidNodeStatus(status string) bool {
	switch status {
	case "idle", "streaming", "done", "error":
		return true
	default:
		return false
	}
}

func isFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

// newBridgeError 把底层 error 转换为稳定 Bridge 错误协议
// code 和 retryable 由调用层根据失败阶段决定 err 必须包含原始上下文
func newBridgeError(code string, err error, retryable bool) *BridgeError {
	if err == nil {
		return nil
	}

	return &BridgeError{
		Code:      code,
		Message:   err.Error(),
		Retryable: retryable,
	}
}
