# Stage 5 Backlog

This file records follow-up work discovered during Stage 5 review. It is not the current implementation scope.

## Code Comments

1. Convert newly added comments to English where requested.
2. Keep future Chinese comments free of Chinese punctuation when Chinese comments are still used.

## UI Polish

1. Restyle the left sidebar.
2. Add a dotted canvas background.
3. Continue polishing Markdown text color so unparsed or low-emphasis content does not become unreadable.
4. Review KaTeX color and spacing after more formula samples are tested.

## Markdown And AI Rendering

1. Review whether Shiki should be preloaded during app idle time.
2. Keep Shiki theme configurable. Current target theme is `one-dark-pro`.
3. Consider richer Markdown rendering cases after table LaTeX and code block testing.

## Card Type Expansion

1. Add future card types such as file cards and other content cards.
2. Keep `ConversationCard` and `ConversationNodeType` as the source of truth for card type expansion.
3. Extract shared type utilities such as `DistributiveOmit` out of store contracts when the type utility layer is created.
4. Decide whether `shape.props.type` should eventually be renamed to `shape.props.cardType`.
5. Add render branch exhaustiveness with `switch` plus `assertNever` when card rendering is refactored.

## Link Semantics And AI Context

1. Define how `parentLink` and `referenceLink` should contribute to AI prompt context after file and other card types exist.
2. Define how each card type exposes content to AI.
3. Define whether parent context and reference context should be serialized differently before sending to AI.
4. Define prompt input handling when a generated card depends on multiple parent or reference cards.

## App State Architecture

1. Split global state currently held in `App.tsx`.
2. Decide which state belongs in Zustand and which state should stay as local UI state.
3. Preserve Store as the single source of truth for conversation data.

## Agent Style Output

1. Explore AI returning a strict JSON payload that ForkMind can render directly.
2. Treat this as an agent-like structured output path.
3. Define validation rules before using returned JSON to update Store.
4. Decide how structured JSON output coexists with normal Markdown response output.

## Creation Flow Refactor

1. Review duplication between `commitNodeCreation` and `createNodeByType`.
2. Consolidate node creation logic so click creation drag creation and link drag creation share one core creation path.
3. Keep Store actions as the stable write boundary.

