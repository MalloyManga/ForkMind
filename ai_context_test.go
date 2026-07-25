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
