package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	openAIRoleSystem    = "system"
	openAIRoleUser      = "user"
	openAIRoleAssistant = "assistant"

	forkMindSystemIdentity = "你是 ForkMind 无限画布中的 AI 助手 请直接回答当前用户问题"
	forkMindContextPolicy  = "画布资料只用于补充语境而不是限制知识来源 相关时优先结合 不相关或不足时可以使用通用知识继续回答"
	forkMindAccuracyPolicy = "不要虚构未提供的画布内容 若需要推测请明确说明"
	forkMindToolPolicy     = "仅当用户明确要求生成或组织多张画布卡片时调用 propose_canvas_plan 一次调用必须包含完整卡片和关系方案"
)

// OpenAIMessageDTO 对应 OpenAI-compatible messages 数组中的单条消息
type OpenAIMessageDTO struct {
	Role          string   `json:"role"`
	Content       string   `json:"-"`
	ImageDataURLs []string `json:"-"`
}

type openAIMessageContentPart struct {
	Type     string                 `json:"type"`
	Text     string                 `json:"text,omitempty"`
	ImageURL *openAIImageURLContent `json:"image_url,omitempty"`
}

type openAIImageURLContent struct {
	URL string `json:"url"`
}

// MarshalJSON 把纯文本消息保持为 string 把带图片的消息编码为 OpenAI-compatible content blocks
// 接收方是 OpenAI-compatible /chat/completions Provider
// 返回值只包含 role 和 content 不暴露 ForkMind 内部 ImageDataURLs 辅助字段
// HTTP 请求 json.Marshal openAIChatCompletionsRequest 时自动触发
func (message OpenAIMessageDTO) MarshalJSON() ([]byte, error) {
	if len(message.ImageDataURLs) == 0 {
		return json.Marshal(struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		}{Role: message.Role, Content: message.Content})
	}

	contentParts := make([]openAIMessageContentPart, 0, len(message.ImageDataURLs)+1)
	contentParts = append(contentParts, openAIMessageContentPart{Type: "text", Text: message.Content})
	for _, dataURL := range message.ImageDataURLs {
		contentParts = append(contentParts, openAIMessageContentPart{
			Type:     "image_url",
			ImageURL: &openAIImageURLContent{URL: dataURL},
		})
	}
	return json.Marshal(struct {
		Role    string                     `json:"role"`
		Content []openAIMessageContentPart `json:"content"`
	}{Role: message.Role, Content: contentParts})
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
	messages := buildOpenAIMessages(mainChain, activeCard.ID, references)

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
	mainChain []ConversationCardDTO,
	activeNodeID string,
	references []AIReferenceDTO,
) []OpenAIMessageDTO {
	messages := make([]OpenAIMessageDTO, 0, len(mainChain)*2+2)
	messages = append(messages, OpenAIMessageDTO{
		Role:    openAIRoleSystem,
		Content: buildForkMindSystemPrompt(mainChain, references),
	})

	backgroundSections := make([]string, 0)
	for _, card := range mainChain {
		if card.SourceAnchor != nil {
			backgroundSections = append(backgroundSections, formatTextAnchor(*card.SourceAnchor))
		}
		if card.CardType != "chat" {
			backgroundContent := formatReferenceCard(card)
			if backgroundContent == "" {
				continue
			}
			backgroundSections = append(
				backgroundSections,
				fmt.Sprintf("[主链资料 %s | %s]\n%s", card.ID, card.CardType, backgroundContent),
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

// buildForkMindSystemPrompt 根据当前 Chat 所处的画布语境生成内部系统提示词
// mainChain 来自当前节点的 parentId 主链 references 来自当前节点的一层引用卡片
// 返回值始终是不可由用户编辑的非空系统指令 根节点不会因为缺少历史资料而拒绝回答
// 用户发送或重新生成 Chat 时由 buildOpenAIMessages 触发
func buildForkMindSystemPrompt(
	mainChain []ConversationCardDTO,
	references []AIReferenceDTO,
) string {
	instructions := []string{
		forkMindSystemIdentity,
		forkMindContextPolicy,
		forkMindAccuracyPolicy,
		forkMindToolPolicy,
	}

	if len(mainChain) > 1 {
		instructions = append(instructions, "当前问题存在主对话历史 请保持回答与已有对话连续")
	}
	if len(references) > 0 {
		instructions = append(instructions, "当前问题附带补充参考卡片 请在确实相关时引用这些资料")
	}
	if len(mainChain) > 0 && mainChain[len(mainChain)-1].SourceAnchor != nil {
		instructions = append(instructions, "当前问题由文本选区发起 请把文本锚点视为追问对象")
	}

	return strings.Join(instructions, "\n")
}

// formatTextAnchor 把子节点保存的源文本选区转换为明确的背景资料标签
// anchor 来自已通过 validateConversationThread 的主链节点 返回值不会伪装成用户消息
// AI 请求包含锚点追问节点时由 buildOpenAIMessages 触发
func formatTextAnchor(anchor TextAnchorDTO) string {
	return fmt.Sprintf(
		"[文本锚点 | 来源 %s | 字段 %s]\n%s",
		anchor.SourceNodeID,
		anchor.Field,
		strings.TrimSpace(anchor.Quote),
	)
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
	case "image":
		sections := make([]string, 0, 3)
		if card.Asset != nil {
			sections = append(sections, formatManagedAssetMetadata(*card.Asset))
		}
		if altText := strings.TrimSpace(card.AltText); altText != "" {
			sections = append(sections, "替代文本:\n"+altText)
		}
		if caption := strings.TrimSpace(card.Caption); caption != "" {
			sections = append(sections, "图片说明:\n"+caption)
		}
		return strings.Join(sections, "\n\n")
	case "link":
		sections := make([]string, 0, 3)
		if title := strings.TrimSpace(card.LinkTitle); title != "" {
			sections = append(sections, "链接标题:\n"+title)
		}
		if linkURL := strings.TrimSpace(card.URL); linkURL != "" {
			sections = append(sections, "链接地址:\n"+linkURL)
		}
		if description := strings.TrimSpace(card.Description); description != "" {
			sections = append(sections, "链接说明:\n"+description)
		}
		return strings.Join(sections, "\n\n")
	case "file":
		sections := make([]string, 0, 2)
		if card.Asset != nil {
			sections = append(sections, formatManagedAssetMetadata(*card.Asset))
		}
		if description := strings.TrimSpace(card.Description); description != "" {
			sections = append(sections, "文件说明:\n"+description)
		}
		return strings.Join(sections, "\n\n")
	default:
		return ""
	}
}

// formatManagedAssetMetadata 把本地资产引用转换为纯文本元数据
// asset 来自已校验的 image 或 file 节点 返回值不包含绝对路径和二进制内容
// AI 主链背景与 reference 格式化时触发
func formatManagedAssetMetadata(asset ManagedAssetDTO) string {
	return fmt.Sprintf(
		"本地资产: %s\nMIME: %s\n大小: %d bytes",
		asset.Name,
		asset.MimeType,
		asset.SizeBytes,
	)
}
