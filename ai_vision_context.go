package main

import (
	"encoding/base64"
	"fmt"
	"strings"
)

const (
	maxAIReferenceImages    = 4
	maxAIReferenceImageSize = 10 * 1024 * 1024
)

var supportedAIVisionMimeTypes = map[string]struct{}{
	"image/gif":  {},
	"image/jpeg": {},
	"image/png":  {},
	"image/webp": {},
}

type AIImageAssetReader func(asset ManagedAssetDTO) (content []byte, detectedMimeType string, err error)

// AttachAIReferenceImages 把本轮相关 Image Card 附加到当前 user message 的多模态内容
// runtimeContext 来自 BuildAIRuntimeContext thread 和 activeNodeID 来自同一次 Bridge 请求
// 返回独立上下文 只读取 parent 主链和当前节点 direct reference 中最多四张受管图片
// 发送 Chat 前触发 Provider 不支持 vision 时由原有 HTTP 错误链返回明确失败
func AttachAIReferenceImages(
	runtimeContext AIRuntimeContextDTO,
	thread ConversationThreadDTO,
	activeNodeID string,
	reader AIImageAssetReader,
) (AIRuntimeContextDTO, error) {
	cardByID := make(map[string]ConversationCardDTO, len(thread.Cards))
	for _, card := range thread.Cards {
		cardByID[card.ID] = card
	}
	activeCard, exists := cardByID[activeNodeID]
	if !exists {
		return AIRuntimeContextDTO{}, fmt.Errorf("active node %q does not exist", activeNodeID)
	}
	mainChain, err := collectMainChain(activeCard, cardByID)
	if err != nil {
		return AIRuntimeContextDTO{}, err
	}

	relevantNodeIDs := make([]string, 0, len(mainChain)+len(activeCard.ReferenceNodeIDs))
	seenNodeIDs := make(map[string]struct{})
	for _, card := range mainChain {
		if card.CardType == "image" {
			relevantNodeIDs = append(relevantNodeIDs, card.ID)
			seenNodeIDs[card.ID] = struct{}{}
		}
	}
	for _, referenceNodeID := range activeCard.ReferenceNodeIDs {
		if _, seen := seenNodeIDs[referenceNodeID]; seen {
			continue
		}
		if cardByID[referenceNodeID].CardType == "image" {
			relevantNodeIDs = append(relevantNodeIDs, referenceNodeID)
			seenNodeIDs[referenceNodeID] = struct{}{}
		}
	}
	if len(relevantNodeIDs) == 0 {
		return runtimeContext, nil
	}
	if len(relevantNodeIDs) > maxAIReferenceImages {
		return AIRuntimeContextDTO{}, fmt.Errorf("AI request references %d images but the limit is %d", len(relevantNodeIDs), maxAIReferenceImages)
	}
	if reader == nil {
		return AIRuntimeContextDTO{}, fmt.Errorf("referenced images require an asset reader")
	}

	imageDataURLs := make([]string, 0, len(relevantNodeIDs))
	for _, nodeID := range relevantNodeIDs {
		imageCard := cardByID[nodeID]
		if imageCard.Asset == nil {
			continue
		}
		content, detectedMimeType, err := reader(*imageCard.Asset)
		if err != nil {
			return AIRuntimeContextDTO{}, fmt.Errorf("read image card %q: %w", nodeID, err)
		}
		normalizedMimeType := strings.ToLower(strings.TrimSpace(detectedMimeType))
		if _, supported := supportedAIVisionMimeTypes[normalizedMimeType]; !supported {
			return AIRuntimeContextDTO{}, fmt.Errorf("image card %q uses unsupported vision MIME %q", nodeID, detectedMimeType)
		}
		if len(content) == 0 || len(content) > maxAIReferenceImageSize {
			return AIRuntimeContextDTO{}, fmt.Errorf("image card %q must contain between 1 and %d bytes", nodeID, maxAIReferenceImageSize)
		}
		imageDataURLs = append(
			imageDataURLs,
			"data:"+normalizedMimeType+";base64,"+base64.StdEncoding.EncodeToString(content),
		)
	}
	if len(imageDataURLs) == 0 {
		return runtimeContext, nil
	}

	nextContext := runtimeContext
	nextContext.Messages = append([]OpenAIMessageDTO(nil), runtimeContext.Messages...)
	for messageIndex := len(nextContext.Messages) - 1; messageIndex >= 0; messageIndex-- {
		if nextContext.Messages[messageIndex].Role != openAIRoleUser {
			continue
		}
		nextContext.Messages[messageIndex].ImageDataURLs = imageDataURLs
		return nextContext, nil
	}
	return AIRuntimeContextDTO{}, fmt.Errorf("AI runtime context does not contain a user message for referenced images")
}
