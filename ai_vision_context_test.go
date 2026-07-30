package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestOpenAIMessageMarshalJSON 验证纯文本保持 string 带图消息升级为 content blocks
func TestOpenAIMessageMarshalJSON(t *testing.T) {
	t.Parallel()

	plainJSON, err := json.Marshal(OpenAIMessageDTO{Role: openAIRoleUser, Content: "hello"})
	if err != nil || string(plainJSON) != `{"role":"user","content":"hello"}` {
		t.Fatalf("plain message JSON = (%s, %v)", plainJSON, err)
	}

	visionJSON, err := json.Marshal(OpenAIMessageDTO{
		Role: openAIRoleUser, Content: "describe", ImageDataURLs: []string{"data:image/png;base64,AQID"},
	})
	if err != nil {
		t.Fatalf("vision message MarshalJSON() error = %v", err)
	}
	var payload struct {
		Content []struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			ImageURL struct {
				URL string `json:"url"`
			} `json:"image_url"`
		} `json:"content"`
	}
	if err := json.Unmarshal(visionJSON, &payload); err != nil {
		t.Fatalf("decode vision message: %v", err)
	}
	if len(payload.Content) != 2 || payload.Content[0].Text != "describe" || payload.Content[1].ImageURL.URL != "data:image/png;base64,AQID" {
		t.Fatalf("vision content = %#v", payload.Content)
	}
}

// TestAttachAIReferenceImages 验证当前节点直接引用图片只附加到最后一条 user message
func TestAttachAIReferenceImages(t *testing.T) {
	t.Parallel()

	thread := createContextTestThread()
	imageNodeID := "reference-image"
	thread.Cards = append(thread.Cards, ConversationCardDTO{
		ID: imageNodeID, CardType: "image", Position: CardPositionDTO{X: 1, Y: 1},
		Size: CardSizeDTO{Mode: "auto", Width: 320, MinHeight: 160}, Status: "idle",
		CreatedAt: thread.CreatedAt, UpdatedAt: thread.UpdatedAt,
		Asset: &ManagedAssetDTO{
			ID: strings.Repeat("a", 64) + ".png", Name: "reference.png", MimeType: "image/png", SizeBytes: 3,
		},
	})
	for cardIndex := range thread.Cards {
		if thread.Cards[cardIndex].ID == "child-chat" {
			thread.Cards[cardIndex].ReferenceNodeIDs = []string{imageNodeID}
		}
	}
	runtimeContext, err := BuildAIRuntimeContext(BuildAIContextInput{Thread: thread, ActiveNodeID: "child-chat"})
	if err != nil {
		t.Fatalf("BuildAIRuntimeContext() error = %v", err)
	}
	nextContext, err := AttachAIReferenceImages(
		runtimeContext,
		thread,
		"child-chat",
		func(asset ManagedAssetDTO) ([]byte, string, error) {
			return []byte{1, 2, 3}, "image/png", nil
		},
	)
	if err != nil {
		t.Fatalf("AttachAIReferenceImages() error = %v", err)
	}
	if len(runtimeContext.Messages[len(runtimeContext.Messages)-1].ImageDataURLs) != 0 {
		t.Fatal("AttachAIReferenceImages() mutated source context")
	}
	lastMessage := nextContext.Messages[len(nextContext.Messages)-1]
	if lastMessage.Role != openAIRoleUser || len(lastMessage.ImageDataURLs) != 1 || lastMessage.ImageDataURLs[0] != "data:image/png;base64,AQID" {
		t.Fatalf("last message = %#v", lastMessage)
	}
}

// TestAttachAIReferenceImagesRejectsUnsupportedMime 验证 SVG 等非视觉请求白名单格式会被拒绝
func TestAttachAIReferenceImagesRejectsUnsupportedMime(t *testing.T) {
	t.Parallel()

	thread := createContextTestThread()
	thread.Cards = append(thread.Cards, ConversationCardDTO{
		ID: "svg-image", CardType: "image", Position: CardPositionDTO{X: 1, Y: 1},
		Size: CardSizeDTO{Mode: "auto", Width: 320, MinHeight: 160}, Status: "idle",
		CreatedAt: thread.CreatedAt, UpdatedAt: thread.UpdatedAt,
		Asset: &ManagedAssetDTO{ID: strings.Repeat("b", 64) + ".svg", Name: "image.svg", MimeType: "image/svg+xml", SizeBytes: 10},
	})
	for cardIndex := range thread.Cards {
		if thread.Cards[cardIndex].ID == "child-chat" {
			thread.Cards[cardIndex].ReferenceNodeIDs = []string{"svg-image"}
		}
	}
	runtimeContext, err := BuildAIRuntimeContext(BuildAIContextInput{Thread: thread, ActiveNodeID: "child-chat"})
	if err != nil {
		t.Fatalf("BuildAIRuntimeContext() error = %v", err)
	}
	_, err = AttachAIReferenceImages(runtimeContext, thread, "child-chat", func(ManagedAssetDTO) ([]byte, string, error) {
		return []byte("<svg/>"), "image/svg+xml", nil
	})
	if err == nil || !strings.Contains(err.Error(), "unsupported vision MIME") {
		t.Fatalf("unsupported MIME error = %v", err)
	}
}
