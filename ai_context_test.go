package main

import (
	"strings"
	"testing"
	"time"
)

// TestBuildAIRuntimeContextOrdersMainChain 验证主链按根到当前节点生成 user assistant 顺序
// 当前节点已有旧回答时必须排除 避免重新生成时污染上下文
func TestBuildAIRuntimeContextOrdersMainChain(t *testing.T) {
	t.Parallel()

	thread := createContextTestThread()
	context, err := BuildAIRuntimeContext(BuildAIContextInput{
		Thread:       thread,
		ActiveNodeID: "child-chat",
		SystemPrompt: "system",
	})
	if err != nil {
		t.Fatalf("BuildAIRuntimeContext() error = %v", err)
	}

	rolesAndContent := make([]string, 0, len(context.Messages))
	for _, message := range context.Messages {
		rolesAndContent = append(rolesAndContent, message.Role+":"+message.Content)
	}
	joined := strings.Join(rolesAndContent, "|")
	wantFragments := []string{
		"system:system",
		"user:root prompt",
		"assistant:root response",
		"user:child prompt",
	}
	for _, fragment := range wantFragments {
		if !strings.Contains(joined, fragment) {
			t.Fatalf("messages %q do not contain %q", joined, fragment)
		}
	}
	if strings.Contains(joined, "old child response") {
		t.Fatalf("messages %q contain active node old response", joined)
	}
}

// TestBuildAIRuntimeContextIsolatesNotesAndReferences 验证 Note 与 reference 进入 system 背景区
// 参考节点不能被伪装成主链 user assistant 消息
func TestBuildAIRuntimeContextIsolatesNotesAndReferences(t *testing.T) {
	t.Parallel()

	thread := createContextTestThread()
	noteParentID := "root-chat"
	thread.Cards = append(thread.Cards, ConversationCardDTO{
		ID:          "chain-note",
		CardType:    "note",
		ParentID:    &noteParentID,
		Position:    CardPositionDTO{X: 0, Y: 0},
		Size:        CardSizeDTO{Mode: "auto", Width: 360, MinHeight: 160},
		Status:      "done",
		CreatedAt:   thread.CreatedAt,
		UpdatedAt:   thread.UpdatedAt,
		NoteContent: "chain background",
	})
	childIndex := findContextTestCardIndex(thread.Cards, "child-chat")
	thread.Cards[childIndex].ParentID = stringPointer("chain-note")
	thread.Cards[childIndex].ReferenceNodeIDs = []string{"reference-note", "root-chat"}

	context, err := BuildAIRuntimeContext(BuildAIContextInput{
		Thread:       thread,
		ActiveNodeID: "child-chat",
		SystemPrompt: "system",
	})
	if err != nil {
		t.Fatalf("BuildAIRuntimeContext() error = %v", err)
	}
	if len(context.References) != 1 {
		t.Fatalf("len(References) = %d, want 1", len(context.References))
	}
	if context.References[0].NodeID != "reference-note" {
		t.Fatalf("References[0].NodeID = %q, want reference-note", context.References[0].NodeID)
	}

	backgroundFound := false
	for _, message := range context.Messages {
		if message.Role == openAIRoleSystem &&
			strings.Contains(message.Content, "chain background") &&
			strings.Contains(message.Content, "reference background") {
			backgroundFound = true
		}
	}
	if !backgroundFound {
		t.Fatal("system background message does not contain chain note and reference note")
	}
}

// TestBuildAIRuntimeContextIncludesTextAnchor 验证文本选区作为背景资料注入而不是伪造 user 消息
func TestBuildAIRuntimeContextIncludesTextAnchor(t *testing.T) {
	t.Parallel()

	thread := createContextTestThread()
	childIndex := findContextTestCardIndex(thread.Cards, "child-chat")
	thread.Cards[childIndex].SourceAnchor = createEditorTextAnchor("root-chat", "aiResponse")

	context, err := BuildAIRuntimeContext(BuildAIContextInput{
		Thread:       thread,
		ActiveNodeID: "child-chat",
		SystemPrompt: "system",
	})
	if err != nil {
		t.Fatalf("BuildAIRuntimeContext() error = %v", err)
	}

	anchorFound := false
	for _, message := range context.Messages {
		if message.Role == openAIRoleSystem &&
			strings.Contains(message.Content, "文本锚点") &&
			strings.Contains(message.Content, "字段 aiResponse") &&
			strings.Contains(message.Content, "quote") {
			anchorFound = true
		}
	}
	if !anchorFound {
		t.Fatalf("messages do not contain text anchor: %#v", context.Messages)
	}
}

// TestBuildAIRuntimeContextRejectsNonChatActiveNode 验证 Note 不能直接发起模型请求
func TestBuildAIRuntimeContextRejectsNonChatActiveNode(t *testing.T) {
	t.Parallel()

	thread := createContextTestThread()
	_, err := BuildAIRuntimeContext(BuildAIContextInput{
		Thread:       thread,
		ActiveNodeID: "reference-note",
		SystemPrompt: "system",
	})
	if err == nil {
		t.Fatal("BuildAIRuntimeContext() error = nil, want non-chat active error")
	}
}

// TestBuildAIRuntimeContextInputErrors 验证会话损坏 节点缺失和空 Prompt 都会在发起 HTTP 前失败
func TestBuildAIRuntimeContextInputErrors(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name          string
		mutate        func(input *BuildAIContextInput)
		errorFragment string
	}{
		{name: "invalid thread", mutate: func(input *BuildAIContextInput) { input.Thread.ID = "" }, errorFragment: "validate context thread"},
		{name: "missing active", mutate: func(input *BuildAIContextInput) { input.ActiveNodeID = "missing" }, errorFragment: "does not exist"},
		{name: "empty prompt", mutate: func(input *BuildAIContextInput) {
			cardIndex := findContextTestCardIndex(input.Thread.Cards, input.ActiveNodeID)
			input.Thread.Cards[cardIndex].UserPrompt = "   "
		}, errorFragment: "prompt cannot be empty"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			input := BuildAIContextInput{Thread: createContextTestThread(), ActiveNodeID: "child-chat", SystemPrompt: "system"}
			testCase.mutate(&input)
			_, err := BuildAIRuntimeContext(input)
			if err == nil || !strings.Contains(err.Error(), testCase.errorFragment) {
				t.Fatalf("BuildAIRuntimeContext() error = %v, want %q", err, testCase.errorFragment)
			}
		})
	}
}

// TestCollectMainChainErrors 验证底层遍历对缺失父节点和循环保持独立防御
// 虽然 Thread validator 会提前拒绝这些输入 帮助函数仍不能依赖调用顺序保证安全
func TestCollectMainChainErrors(t *testing.T) {
	t.Parallel()

	activeCard := ConversationCardDTO{ID: "active", CardType: "chat", ParentID: stringPointer("missing")}
	if _, err := collectMainChain(activeCard, map[string]ConversationCardDTO{"active": activeCard}); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("missing parent error = %v", err)
	}

	parentID := "parent"
	activeCard.ParentID = &parentID
	parentCard := ConversationCardDTO{ID: parentID, CardType: "chat", ParentID: stringPointer(activeCard.ID)}
	if _, err := collectMainChain(activeCard, map[string]ConversationCardDTO{"active": activeCard, parentID: parentCard}); err == nil || !strings.Contains(err.Error(), "cycle") {
		t.Fatalf("cycle error = %v", err)
	}
}

// TestCollectDirectReferencesBoundaries 验证引用顺序 去重 主链过滤和缺失引用错误
func TestCollectDirectReferencesBoundaries(t *testing.T) {
	t.Parallel()

	activeCard := ConversationCardDTO{
		ID:               "active",
		ReferenceNodeIDs: []string{"main", "note", "note", "chat"},
	}
	cardByID := map[string]ConversationCardDTO{
		"active": activeCard,
		"main":   {ID: "main", CardType: "chat", UserPrompt: "main"},
		"note":   {ID: "note", CardType: "note", NoteContent: "note content"},
		"chat":   {ID: "chat", CardType: "chat", UserPrompt: "question", AIResponse: "answer"},
	}
	references, err := collectDirectReferences(activeCard, cardByID, map[string]struct{}{"main": {}})
	if err != nil {
		t.Fatalf("collectDirectReferences() error = %v", err)
	}
	if len(references) != 2 || references[0].NodeID != "note" || references[1].NodeID != "chat" {
		t.Fatalf("references = %#v", references)
	}

	activeCard.ReferenceNodeIDs = []string{"missing"}
	if _, err := collectDirectReferences(activeCard, cardByID, nil); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("missing reference error = %v", err)
	}
}

// TestBuildOpenAIMessagesWithoutSystemPrompt 验证空 system prompt 不生成空消息
// Note 背景与历史 chat 仍保持正确角色顺序
func TestBuildOpenAIMessagesWithoutSystemPrompt(t *testing.T) {
	t.Parallel()

	mainChain := []ConversationCardDTO{
		{ID: "note", CardType: "note", NoteContent: " background "},
		{ID: "history", CardType: "chat", UserPrompt: " old question ", AIResponse: " old answer "},
		{ID: "active", CardType: "chat", UserPrompt: " current question ", AIResponse: " ignored answer "},
	}
	messages := buildOpenAIMessages("   ", mainChain, "active", nil)
	if len(messages) != 4 {
		t.Fatalf("len(messages) = %d, want 4: %#v", len(messages), messages)
	}
	roles := []string{messages[0].Role, messages[1].Role, messages[2].Role, messages[3].Role}
	if strings.Join(roles, ",") != "system,user,assistant,user" {
		t.Fatalf("roles = %v", roles)
	}
	if strings.Contains(messages[len(messages)-1].Content, "ignored answer") {
		t.Fatalf("active response leaked into messages: %#v", messages)
	}
}

// TestFormatReferenceCardVariants 验证 chat note 和未来未知类型的纯文本转换
func TestFormatReferenceCardVariants(t *testing.T) {
	t.Parallel()

	chatContent := formatReferenceCard(ConversationCardDTO{
		CardType:   "chat",
		UserPrompt: " question ",
		AIResponse: " answer ",
	})
	if !strings.Contains(chatContent, "用户问题:\nquestion") || !strings.Contains(chatContent, "AI 回答:\nanswer") {
		t.Fatalf("chat reference = %q", chatContent)
	}
	if content := formatReferenceCard(ConversationCardDTO{CardType: "chat"}); content != "" {
		t.Fatalf("empty chat reference = %q", content)
	}
	if content := formatReferenceCard(ConversationCardDTO{CardType: "note", NoteContent: " note "}); content != "note" {
		t.Fatalf("note reference = %q", content)
	}
	if content := formatReferenceCard(ConversationCardDTO{CardType: "future"}); content != "" {
		t.Fatalf("unknown reference = %q", content)
	}
}

// TestFormatTextAnchor 验证锚点标签会保留来源 字段和去空白后的 quote
func TestFormatTextAnchor(t *testing.T) {
	t.Parallel()

	formatted := formatTextAnchor(TextAnchorDTO{
		SourceNodeID: "source",
		Field:        "noteContent",
		Quote:        "  selected text  ",
	})
	for _, fragment := range []string{"来源 source", "字段 noteContent", "selected text"} {
		if !strings.Contains(formatted, fragment) {
			t.Fatalf("formatTextAnchor() = %q, want %q", formatted, fragment)
		}
	}
}

// createContextTestThread 返回上下文算法测试使用的合法混合节点会话
func createContextTestThread() ConversationThreadDTO {
	now := time.Date(2026, time.July, 25, 12, 0, 0, 0, time.UTC).Format(time.RFC3339Nano)
	rootID := "root-chat"
	return ConversationThreadDTO{
		ID:        "context-thread",
		Title:     "context test",
		CreatedAt: now,
		UpdatedAt: now,
		Cards: []ConversationCardDTO{
			{
				ID:         rootID,
				CardType:   "chat",
				Position:   CardPositionDTO{X: 0, Y: 0},
				Size:       CardSizeDTO{Mode: "auto", Width: 360, MinHeight: 160},
				Status:     "done",
				CreatedAt:  now,
				UpdatedAt:  now,
				UserPrompt: "root prompt",
				AIResponse: "root response",
			},
			{
				ID:         "child-chat",
				CardType:   "chat",
				ParentID:   &rootID,
				Position:   CardPositionDTO{X: 400, Y: 0},
				Size:       CardSizeDTO{Mode: "auto", Width: 360, MinHeight: 160},
				Status:     "done",
				CreatedAt:  now,
				UpdatedAt:  now,
				UserPrompt: "child prompt",
				AIResponse: "old child response",
			},
			{
				ID:          "reference-note",
				CardType:    "note",
				Position:    CardPositionDTO{X: 0, Y: 300},
				Size:        CardSizeDTO{Mode: "auto", Width: 360, MinHeight: 160},
				Status:      "done",
				CreatedAt:   now,
				UpdatedAt:   now,
				NoteContent: "reference background",
			},
		},
	}
}

func findContextTestCardIndex(cards []ConversationCardDTO, nodeID string) int {
	for cardIndex, card := range cards {
		if card.ID == nodeID {
			return cardIndex
		}
	}
	return -1
}

func stringPointer(value string) *string {
	return &value
}
