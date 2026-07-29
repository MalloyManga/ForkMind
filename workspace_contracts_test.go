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
		{name: "card type", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].CardType = "future" }, errorFragment: "cardType"},
		{name: "status", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].Status = "unknown" }, errorFragment: "status"},
		{name: "position", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].Position.X = math.Inf(1) }, errorFragment: "position"},
		{name: "size finite", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].Size.Width = math.NaN() }, errorFragment: "size"},
		{name: "size positive", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].Size.MinHeight = 0 }, errorFragment: "size"},
		{name: "size mode", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].Size.Mode = "free" }, errorFragment: "size.mode"},
		{name: "card created at", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].CreatedAt = "bad" }, errorFragment: "createdAt"},
		{name: "card updated at", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].UpdatedAt = "bad" }, errorFragment: "updatedAt"},
		{name: "asset on chat", mutate: func(thread *ConversationThreadDTO) {
			thread.Cards[0].Asset = createTestManagedAsset("image/png")
		}, errorFragment: "asset is invalid"},
		{name: "asset id", mutate: func(thread *ConversationThreadDTO) {
			thread.Cards[0].CardType = "file"
			thread.Cards[0].Asset = createTestManagedAsset("application/pdf")
			thread.Cards[0].Asset.ID = "../bad"
		}, errorFragment: "asset"},
		{name: "asset name", mutate: func(thread *ConversationThreadDTO) {
			thread.Cards[0].CardType = "file"
			thread.Cards[0].Asset = createTestManagedAsset("application/pdf")
			thread.Cards[0].Asset.Name = " "
		}, errorFragment: "name"},
		{name: "asset mime", mutate: func(thread *ConversationThreadDTO) {
			thread.Cards[0].CardType = "file"
			thread.Cards[0].Asset = createTestManagedAsset("")
		}, errorFragment: "mimeType"},
		{name: "asset size", mutate: func(thread *ConversationThreadDTO) {
			thread.Cards[0].CardType = "file"
			thread.Cards[0].Asset = createTestManagedAsset("application/pdf")
			thread.Cards[0].Asset.SizeBytes = 0
		}, errorFragment: "sizeBytes"},
		{name: "image mime", mutate: func(thread *ConversationThreadDTO) {
			thread.Cards[0].CardType = "image"
			thread.Cards[0].Asset = createTestManagedAsset("application/pdf")
		}, errorFragment: "image asset"},
		{name: "link url", mutate: func(thread *ConversationThreadDTO) {
			thread.Cards[0].CardType = "link"
			thread.Cards[0].URL = "ftp://example.com"
		}, errorFragment: "http or https"},
		{name: "parent self", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].ParentID = stringPointer(thread.Cards[0].ID) }, errorFragment: "cannot reference itself"},
		{name: "parent missing", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].ParentID = stringPointer("missing") }, errorFragment: "parentId"},
		{name: "reference self", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].ReferenceNodeIDs = []string{thread.Cards[0].ID} }, errorFragment: "cannot reference itself"},
		{name: "reference missing", mutate: func(thread *ConversationThreadDTO) { thread.Cards[0].ReferenceNodeIDs = []string{"missing"} }, errorFragment: "referenceNodeId"},
		{name: "reference duplicate", mutate: func(thread *ConversationThreadDTO) {
			secondCard := createSecondTestCard(*thread)
			thread.Cards = append(thread.Cards, secondCard)
			thread.Cards[0].ReferenceNodeIDs = []string{secondCard.ID, secondCard.ID}
		}, errorFragment: "is duplicated"},
		{name: "anchor self", mutate: func(thread *ConversationThreadDTO) {
			thread.Cards[0].SourceAnchor = createEditorTextAnchor(thread.Cards[0].ID, "userPrompt")
		}, errorFragment: "sourceAnchor cannot reference itself"},
		{name: "anchor missing source", mutate: func(thread *ConversationThreadDTO) {
			thread.Cards[0].SourceAnchor = createEditorTextAnchor("missing", "userPrompt")
		}, errorFragment: "sourceAnchor.sourceNodeId"},
		{name: "anchor empty quote", mutate: func(thread *ConversationThreadDTO) {
			secondCard := createSecondTestCard(*thread)
			thread.Cards = append(thread.Cards, secondCard)
			thread.Cards[0].SourceAnchor = createEditorTextAnchor(secondCard.ID, "userPrompt")
			thread.Cards[0].SourceAnchor.Quote = "  "
		}, errorFragment: "quote cannot be empty"},
		{name: "anchor incompatible field", mutate: func(thread *ConversationThreadDTO) {
			secondCard := createSecondTestCard(*thread)
			secondCard.CardType = "note"
			thread.Cards = append(thread.Cards, secondCard)
			thread.Cards[0].SourceAnchor = createEditorTextAnchor(secondCard.ID, "userPrompt")
		}, errorFragment: "field"},
		{name: "anchor editor offsets", mutate: func(thread *ConversationThreadDTO) {
			secondCard := createSecondTestCard(*thread)
			thread.Cards = append(thread.Cards, secondCard)
			thread.Cards[0].SourceAnchor = createEditorTextAnchor(secondCard.ID, "userPrompt")
			thread.Cards[0].SourceAnchor.EndOffset = intPointer(0)
		}, errorFragment: "editor offsets"},
		{name: "anchor canvas offsets", mutate: func(thread *ConversationThreadDTO) {
			secondCard := createSecondTestCard(*thread)
			thread.Cards = append(thread.Cards, secondCard)
			thread.Cards[0].SourceAnchor = &TextAnchorDTO{
				SourceNodeID: secondCard.ID,
				Field:        "userPrompt",
				Quote:        "quote",
				StartOffset:  intPointer(0),
				Origin:       "canvas",
			}
		}, errorFragment: "canvas offsets"},
		{name: "anchor origin", mutate: func(thread *ConversationThreadDTO) {
			secondCard := createSecondTestCard(*thread)
			thread.Cards = append(thread.Cards, secondCard)
			thread.Cards[0].SourceAnchor = createEditorTextAnchor(secondCard.ID, "userPrompt")
			thread.Cards[0].SourceAnchor.Origin = "unknown"
		}, errorFragment: "sourceAnchor.origin"},
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
	if !isTextAnchorFieldCompatible("chat", "userPrompt") ||
		!isTextAnchorFieldCompatible("chat", "aiResponse") ||
		!isTextAnchorFieldCompatible("note", "noteContent") ||
		!isTextAnchorFieldCompatible("image", "caption") ||
		!isTextAnchorFieldCompatible("image", "altText") ||
		!isTextAnchorFieldCompatible("link", "url") ||
		!isTextAnchorFieldCompatible("link", "title") ||
		!isTextAnchorFieldCompatible("link", "description") ||
		!isTextAnchorFieldCompatible("file", "description") ||
		isTextAnchorFieldCompatible("note", "userPrompt") ||
		isTextAnchorFieldCompatible("future", "noteContent") {
		t.Fatal("isTextAnchorFieldCompatible() returned an invalid result")
	}
	if bridgeError := newBridgeError("code", nil, false); bridgeError != nil {
		t.Fatalf("newBridgeError(nil) = %#v, want nil", bridgeError)
	}
	bridgeError := newBridgeError("code", errors.New("message"), true)
	if bridgeError.Code != "code" || bridgeError.Message != "message" || !bridgeError.Retryable {
		t.Fatalf("newBridgeError() = %#v", bridgeError)
	}
}

// TestValidateConversationThreadSupportsLocalMetadataCards 验证三种扩展卡片能进入同一工作区契约
func TestValidateConversationThreadSupportsLocalMetadataCards(t *testing.T) {
	t.Parallel()

	thread := createTestWorkspaceDocument().Threads[0]
	imageCard := createSecondTestCard(thread)
	imageCard.ID = "image-node"
	imageCard.CardType = "image"
	imageCard.Asset = createTestManagedAsset("image/png")
	imageCard.Caption = "diagram"
	fileCard := createSecondTestCard(thread)
	fileCard.ID = "file-node"
	fileCard.CardType = "file"
	fileCard.Asset = createTestManagedAsset("application/pdf")
	fileCard.Description = "specification"
	linkCard := createSecondTestCard(thread)
	linkCard.ID = "link-node"
	linkCard.CardType = "link"
	linkCard.URL = "https://example.com/docs"
	linkCard.LinkTitle = "Docs"
	thread.Cards = append(thread.Cards, imageCard, fileCard, linkCard)

	if err := validateConversationThread(thread); err != nil {
		t.Fatalf("validateConversationThread() error = %v", err)
	}
}

func createTestManagedAsset(mimeType string) *ManagedAssetDTO {
	return &ManagedAssetDTO{
		ID:        strings.Repeat("a", 64) + ".bin",
		Name:      "asset.bin",
		MimeType:  mimeType,
		SizeBytes: 128,
	}
}

// createEditorTextAnchor 构造字段级合法的编辑器文本锚点
func createEditorTextAnchor(sourceNodeID string, field string) *TextAnchorDTO {
	return &TextAnchorDTO{
		SourceNodeID: sourceNodeID,
		Field:        field,
		Quote:        "quote",
		StartOffset:  intPointer(0),
		EndOffset:    intPointer(5),
		Origin:       "editor",
	}
}

func intPointer(value int) *int {
	return &value
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
