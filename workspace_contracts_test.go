package main

import (
	"errors"
	"math"
	"strings"
	"testing"
)

// TestValidateWorkspaceDocumentBoundaries 逐项验证工作区顶层契约
// 每个测试从独立合法文档开始 只破坏一个字段以精确定位错误来源
func TestValidateWorkspaceDocumentBoundaries(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name          string
		mutate        func(document *WorkspaceDocumentDTO)
		errorFragment string
	}{
		{name: "format", mutate: func(document *WorkspaceDocumentDTO) { document.Format = "wrong" }, errorFragment: "format must be"},
		{name: "version", mutate: func(document *WorkspaceDocumentDTO) { document.Version = "2" }, errorFragment: "unsupported workspace version"},
		{name: "threads", mutate: func(document *WorkspaceDocumentDTO) { document.Threads = nil }, errorFragment: "at least one thread"},
		{name: "last modified", mutate: func(document *WorkspaceDocumentDTO) { document.LastModified = "invalid" }, errorFragment: "lastModified is invalid"},
		{name: "base url", mutate: func(document *WorkspaceDocumentDTO) { document.Settings.BaseURL = "" }, errorFragment: "baseUrl cannot be empty"},
		{name: "temperature nan", mutate: func(document *WorkspaceDocumentDTO) { document.Settings.Temperature = math.NaN() }, errorFragment: "temperature must be finite"},
		{name: "temperature range", mutate: func(document *WorkspaceDocumentDTO) { document.Settings.Temperature = 3 }, errorFragment: "between 0 and 2"},
		{name: "max tokens", mutate: func(document *WorkspaceDocumentDTO) { document.Settings.MaxTokens = 0 }, errorFragment: "maxTokens must be positive"},
		{name: "duplicate thread", mutate: func(document *WorkspaceDocumentDTO) { document.Threads = append(document.Threads, document.Threads[0]) }, errorFragment: "is duplicated"},
		{name: "active thread", mutate: func(document *WorkspaceDocumentDTO) { document.ActiveThreadID = "missing" }, errorFragment: "does not exist"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			document := createTestWorkspaceDocument()
			testCase.mutate(&document)
			assertValidationErrorContains(t, validateWorkspaceDocument(document), testCase.errorFragment)
		})
	}
}

// TestValidateConversationThreadBoundaries 逐项验证节点字段与图关系契约
// 该表覆盖前端校验被绕过时 Go Repository 的最后一道防线
func TestValidateConversationThreadBoundaries(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name          string
		mutate        func(thread *ConversationThreadDTO)
		errorFragment string
	}{
		{name: "thread id", mutate: func(thread *ConversationThreadDTO) { thread.ID = "" }, errorFragment: "id cannot be empty"},
		{name: "title", mutate: func(thread *ConversationThreadDTO) { thread.Title = "" }, errorFragment: "title cannot be empty"},
		{name: "created at", mutate: func(thread *ConversationThreadDTO) { thread.CreatedAt = "bad" }, errorFragment: "createdAt is invalid"},
		{name: "updated at", mutate: func(thread *ConversationThreadDTO) { thread.UpdatedAt = "bad" }, errorFragment: "updatedAt is invalid"},
		{name: "card id", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].ID = "" }, errorFragment: "id cannot be empty"},
		{name: "duplicate card", mutate: func(thread *ConversationThreadDTO) { thread.Cards = append(thread.Cards, thread.Cards[0]) }, errorFragment: "is duplicated"},
		{name: "card type", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].CardType = "image" }, errorFragment: "cardType"},
		{name: "status", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].Status = "unknown" }, errorFragment: "status"},
		{name: "position", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].Position.X = math.Inf(1) }, errorFragment: "position"},
		{name: "size finite", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].Size.Width = math.NaN() }, errorFragment: "size"},
		{name: "size positive", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].Size.MinHeight = 0 }, errorFragment: "size"},
		{name: "size mode", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].Size.Mode = "free" }, errorFragment: "size.mode"},
		{name: "card created at", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].CreatedAt = "bad" }, errorFragment: "createdAt"},
		{name: "card updated at", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].UpdatedAt = "bad" }, errorFragment: "updatedAt"},
		{name: "parent self", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].ParentID = stringPointer(thread.Cards[0].ID) }, errorFragment: "cannot reference itself"},
		{name: "parent missing", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].ParentID = stringPointer("missing") }, errorFragment: "parentId"},
		{name: "reference self", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].ReferenceNodeIDs = []string{thread.Cards[0].ID} }, errorFragment: "cannot reference itself"},
		{name: "reference missing", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].ReferenceNodeIDs = []string{"missing"} }, errorFragment: "referenceNodeId"},
		{name: "reference duplicate", mutate: func(thread *ConversationThreadDTO) {
			secondCard := createSecondTestCard(*thread)
			thread.Cards = append(thread.Cards, secondCard)
			thread.Cards[0].ReferenceNodeIDs = []string{secondCard.ID, secondCard.ID}
		}, errorFragment: "is duplicated"},
		{name: "parent cycle", mutate: func(thread *ConversationThreadDTO) {
			secondCard := createSecondTestCard(*thread)
			thread.Cards = append(thread.Cards, secondCard)
			thread.Cards[0].ParentID = stringPointer(secondCard.ID)
			thread.Cards[1].ParentID = stringPointer(thread.Cards[0].ID)
		}, errorFragment: "creates a cycle"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			thread := createTestWorkspaceDocument().Threads[0]
			testCase.mutate(&thread)
			assertValidationErrorContains(t, validateConversationThread(thread), testCase.errorFragment)
		})
	}
}

// TestWorkspaceContractHelpers 验证状态枚举 有限数与 BridgeError 转换
func TestWorkspaceContractHelpers(t *testing.T) {
	t.Parallel()

	for _, status := range []string{"idle", "streaming", "done", "error"} {
		if !isValidNodeStatus(status) {
			t.Fatalf("isValidNodeStatus(%q) = false", status)
		}
	}
	if isValidNodeStatus("invalid") {
		t.Fatal("isValidNodeStatus(invalid) = true")
	}
	if !isFinite(1.5) || isFinite(math.Inf(-1)) || isFinite(math.NaN()) {
		t.Fatal("isFinite() returned an invalid result")
	}
	if bridgeError := newBridgeError("code", nil, false); bridgeError != nil {
		t.Fatalf("newBridgeError(nil) = %#v, want nil", bridgeError)
	}
	bridgeError := newBridgeError("code", errors.New("message"), true)
	if bridgeError.Code != "code" || bridgeError.Message != "message" || !bridgeError.Retryable {
		t.Fatalf("newBridgeError() = %#v", bridgeError)
	}
}

// createSecondTestCard 基于合法测试会话生成具有唯一 id 的第二张卡片
func createSecondTestCard(thread ConversationThreadDTO) ConversationCardDTO {
	secondCard := thread.Cards[0]
	secondCard.ID = "node-2"
	secondCard.ParentID = nil
	secondCard.ReferenceNodeIDs = nil
	return secondCard
}

// assertValidationErrorContains 验证错误存在且包含预期领域字段
func assertValidationErrorContains(t *testing.T, err error, expectedFragment string) {
	t.Helper()
	if err == nil || !strings.Contains(err.Error(), expectedFragment) {
		t.Fatalf("validation error = %v, want fragment %q", err, expectedFragment)
	}
}
