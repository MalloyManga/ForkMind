package main

import "fmt"

type AIAssetTextReader func(asset ManagedAssetDTO) (string, error)

// HydrateAIFileReferences 为本轮 AI 请求中的相关 File Card 注入已提取正文
// thread 和 activeNodeID 来自 StartChatCompletion reader 只允许读取 WorkspaceRepository 管理的 asset id
// 返回独立会话快照 原始 Bridge 入参不会被修改 没有相关文件时原样克隆返回
// 发送 Chat 前触发 仅处理 parent 主链和当前节点的一层 direct reference
func HydrateAIFileReferences(
	thread ConversationThreadDTO,
	activeNodeID string,
	reader AIAssetTextReader,
) (ConversationThreadDTO, error) {
	if err := validateConversationThread(thread); err != nil {
		return ConversationThreadDTO{}, fmt.Errorf("validate file context thread: %w", err)
	}

	cardByID := make(map[string]ConversationCardDTO, len(thread.Cards))
	for _, card := range thread.Cards {
		cardByID[card.ID] = card
	}
	activeCard, exists := cardByID[activeNodeID]
	if !exists {
		return ConversationThreadDTO{}, fmt.Errorf("active node %q does not exist", activeNodeID)
	}
	mainChain, err := collectMainChain(activeCard, cardByID)
	if err != nil {
		return ConversationThreadDTO{}, err
	}

	relevantNodeIDs := make(map[string]struct{}, len(mainChain)+len(activeCard.ReferenceNodeIDs))
	for _, card := range mainChain {
		relevantNodeIDs[card.ID] = struct{}{}
	}
	for _, referenceNodeID := range activeCard.ReferenceNodeIDs {
		relevantNodeIDs[referenceNodeID] = struct{}{}
	}

	hydratedThread := thread
	hydratedThread.Cards = append([]ConversationCardDTO(nil), thread.Cards...)
	for cardIndex, card := range hydratedThread.Cards {
		if _, relevant := relevantNodeIDs[card.ID]; !relevant || card.CardType != "file" || card.Asset == nil {
			continue
		}
		if reader == nil {
			return ConversationThreadDTO{}, fmt.Errorf("file card %q requires an asset text reader", card.ID)
		}
		extractedText, err := reader(*card.Asset)
		if err != nil {
			return ConversationThreadDTO{}, fmt.Errorf("extract file card %q: %w", card.ID, err)
		}
		if card.Description != "" {
			card.Description += "\n\n"
		}
		card.Description += "[本地文件正文]\n" + extractedText
		hydratedThread.Cards[cardIndex] = card
	}

	return hydratedThread, nil
}
