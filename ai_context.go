package main

import (
	"fmt"
	"strings"
)

const (
	openAIRoleSystem    = "system"
	openAIRoleUser      = "user"
	openAIRoleAssistant = "assistant"
)

// OpenAIMessageDTO 对应 OpenAI-compatible messages 数组中的单条消息
type OpenAIMessageDTO struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// AIReferenceDTO 表示从 referenceNodeIds 提取出的直接参考资料
// Content 已转换为带业务标签的纯文本 不会伪装成 user assistant 因果消息
type AIReferenceDTO struct {
	NodeID   string `json:"nodeId"`
	CardType string `json:"cardType"`
	Content  string `json:"content"`
}

// AIRuntimeContextDTO 是送往 OpenAI Provider 前的纯净上下文
// Messages 已包含 system 背景资料和按时间排序的主链消息
type AIRuntimeContextDTO struct {
	ActiveNodeID string             `json:"activeNodeId"`
	Messages     []OpenAIMessageDTO `json:"messages"`
	References   []AIReferenceDTO   `json:"references"`
}

// BuildAIContextInput 是上下文组装入口参数
// Thread 来自当前 Zustand 会话 ActiveNodeID 是用户点击发送的 chat 节点
type BuildAIContextInput struct {
	Thread       ConversationThreadDTO `json:"thread"`
	ActiveNodeID string                `json:"activeNodeId"`
	SystemPrompt string                `json:"systemPrompt"`
}

// BuildAIRuntimeContext 根据 parent 主链和当前节点直接 reference 构造 OpenAI messages
// input 来自发送 AI 请求的 Bridge 方法
// 返回错误表示节点不存在 当前节点不是 chat 主链损坏或当前 Prompt 为空
func BuildAIRuntimeContext(input BuildAIContextInput) (AIRuntimeContextDTO, error) {
	if err := validateConversationThread(input.Thread); err != nil {
		return AIRuntimeContextDTO{}, fmt.Errorf("validate context thread: %w", err)
	}

	cardByID := make(map[string]ConversationCardDTO, len(input.Thread.Cards))
	for _, card := range input.Thread.Cards {
		cardByID[card.ID] = card
	}

	activeCard, exists := cardByID[input.ActiveNodeID]
	if !exists {
		return AIRuntimeContextDTO{}, fmt.Errorf("active node %q does not exist", input.ActiveNodeID)
	}
	if activeCard.CardType != "chat" {
		return AIRuntimeContextDTO{}, fmt.Errorf("active node %q must be a chat card", input.ActiveNodeID)
	}
	if strings.TrimSpace(activeCard.UserPrompt) == "" {
		return AIRuntimeContextDTO{}, fmt.Errorf("active chat prompt cannot be empty")
	}

	mainChain, err := collectMainChain(activeCard, cardByID)
	if err != nil {
		return AIRuntimeContextDTO{}, err
	}
	mainChainIDSet := make(map[string]struct{}, len(mainChain))
	for _, card := range mainChain {
		mainChainIDSet[card.ID] = struct{}{}
	}

	references, err := collectDirectReferences(activeCard, cardByID, mainChainIDSet)
	if err != nil {
		return AIRuntimeContextDTO{}, err
	}
	messages := buildOpenAIMessages(input.SystemPrompt, mainChain, activeCard.ID, references)

	return AIRuntimeContextDTO{
		ActiveNodeID: activeCard.ID,
		Messages:     messages,
		References:   references,
	}, nil
}

// collectMainChain 从当前节点沿 parentId 向上收集并反转为根到当前节点顺序
// activeCard 和 cardByID 来自同一个已校验 Thread
// 返回值包含 activeCard 本身 因此最后一条 user 消息就是当前问题
func collectMainChain(
	activeCard ConversationCardDTO,
	cardByID map[string]ConversationCardDTO,
) ([]ConversationCardDTO, error) {
	reversedChain := make([]ConversationCardDTO, 0)
	visitedIDs := make(map[string]struct{})
	cursor := activeCard

	for {
		if _, visited := visitedIDs[cursor.ID]; visited {
			return nil, fmt.Errorf("parent chain contains a cycle at node %q", cursor.ID)
		}
		visitedIDs[cursor.ID] = struct{}{}
		reversedChain = append(reversedChain, cursor)

		if cursor.ParentID == nil {
			break
		}
		parentCard, exists := cardByID[*cursor.ParentID]
		if !exists {
			return nil, fmt.Errorf("parent node %q does not exist", *cursor.ParentID)
		}
		cursor = parentCard
	}

	mainChain := make([]ConversationCardDTO, len(reversedChain))
	for reversedIndex := len(reversedChain) - 1; reversedIndex >= 0; reversedIndex-- {
		mainChain[len(reversedChain)-1-reversedIndex] = reversedChain[reversedIndex]
	}

	return mainChain, nil
}

// collectDirectReferences 读取当前节点的一层 referenceNodeIds
// mainChainIDSet 用于排除已经出现在因果主链中的节点
// 返回值保持用户 referenceNodeIds 的原始顺序并自动去重
func collectDirectReferences(
	activeCard ConversationCardDTO,
	cardByID map[string]ConversationCardDTO,
	mainChainIDSet map[string]struct{},
) ([]AIReferenceDTO, error) {
	references := make([]AIReferenceDTO, 0, len(activeCard.ReferenceNodeIDs))
	seenReferenceIDs := make(map[string]struct{}, len(activeCard.ReferenceNodeIDs))

	for _, referenceNodeID := range activeCard.ReferenceNodeIDs {
		if _, duplicated := seenReferenceIDs[referenceNodeID]; duplicated {
			continue
		}
		seenReferenceIDs[referenceNodeID] = struct{}{}
		if _, alreadyInMainChain := mainChainIDSet[referenceNodeID]; alreadyInMainChain {
			continue
		}

		referenceCard, exists := cardByID[referenceNodeID]
		if !exists {
			return nil, fmt.Errorf("reference node %q does not exist", referenceNodeID)
		}
		references = append(references, AIReferenceDTO{
			NodeID:   referenceCard.ID,
			CardType: referenceCard.CardType,
			Content:  formatReferenceCard(referenceCard),
		})
	}

	return references, nil
}

// buildOpenAIMessages 把领域主链转换为 OpenAI-compatible messages
// activeNodeID 用于排除当前节点旧 aiResponse 避免 Retry 时把旧答案当成历史
// Note 主链和 reference 统一进入 system 背景区 不伪造 user assistant 角色
func buildOpenAIMessages(
	systemPrompt string,
	mainChain []ConversationCardDTO,
	activeNodeID string,
	references []AIReferenceDTO,
) []OpenAIMessageDTO {
	messages := make([]OpenAIMessageDTO, 0, len(mainChain)*2+2)
	normalizedSystemPrompt := strings.TrimSpace(systemPrompt)
	if normalizedSystemPrompt != "" {
		messages = append(messages, OpenAIMessageDTO{
			Role:    openAIRoleSystem,
			Content: normalizedSystemPrompt,
		})
	}

	backgroundSections := make([]string, 0)
	for _, card := range mainChain {
		if card.CardType == "note" && strings.TrimSpace(card.NoteContent) != "" {
			backgroundSections = append(
				backgroundSections,
				fmt.Sprintf("[主链笔记 %s]\n%s", card.ID, strings.TrimSpace(card.NoteContent)),
			)
		}
	}
	for referenceIndex, reference := range references {
		backgroundSections = append(
			backgroundSections,
			fmt.Sprintf("[补充参考 %d | %s]\n%s", referenceIndex+1, reference.NodeID, reference.Content),
		)
	}
	if len(backgroundSections) > 0 {
		messages = append(messages, OpenAIMessageDTO{
			Role: openAIRoleSystem,
			Content: "以下内容是背景资料 不代表 user assistant 的因果对话 请仅在相关时引用:\n\n" +
				strings.Join(backgroundSections, "\n\n---\n\n"),
		})
	}

	for _, card := range mainChain {
		if card.CardType != "chat" {
			continue
		}
		if normalizedPrompt := strings.TrimSpace(card.UserPrompt); normalizedPrompt != "" {
			messages = append(messages, OpenAIMessageDTO{
				Role:    openAIRoleUser,
				Content: normalizedPrompt,
			})
		}
		if card.ID == activeNodeID {
			continue
		}
		if normalizedResponse := strings.TrimSpace(card.AIResponse); normalizedResponse != "" {
			messages = append(messages, OpenAIMessageDTO{
				Role:    openAIRoleAssistant,
				Content: normalizedResponse,
			})
		}
	}

	return messages
}

// formatReferenceCard 把 chat note 节点转换为参考资料文本
// chat 同时保留用户问题与 AI 回答 note 直接使用笔记正文
func formatReferenceCard(card ConversationCardDTO) string {
	switch card.CardType {
	case "chat":
		sections := make([]string, 0, 2)
		if prompt := strings.TrimSpace(card.UserPrompt); prompt != "" {
			sections = append(sections, "用户问题:\n"+prompt)
		}
		if response := strings.TrimSpace(card.AIResponse); response != "" {
			sections = append(sections, "AI 回答:\n"+response)
		}
		return strings.Join(sections, "\n\n")
	case "note":
		return strings.TrimSpace(card.NoteContent)
	default:
		return ""
	}
}
