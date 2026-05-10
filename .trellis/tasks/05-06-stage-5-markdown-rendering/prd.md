# Stage 5 Markdown Rendering Polish

## Goal
Improve ForkMind card Markdown rendering so AI-style Markdown output displays closer to mainstream web AI products while preserving the original Store content.

## Scope

1. Add a render-only Markdown normalization step.
   - Keep raw Store text unchanged.
   - Normalize only before `react-markdown` rendering.
   - Preserve AI-style blockquote line breaks so text like `> 天气` followed by `> 不错` renders as two visible quote lines instead of collapsing into one paragraph line.

2. Improve link rendering.
   - Links should be visually blue and underlined.
   - Links should open through normal browser behavior.
   - Do not add Wails-specific link opening behavior in this task.

3. Complete heading rendering.
   - Support h1 through h6.
   - Keep visual scale compact enough for canvas cards.

4. Add table rendering styles.
   - `remark-gfm` already parses GFM tables.
   - Add table / thead / tbody / tr / th / td component styles.
   - Ensure wide tables scroll horizontally instead of breaking card layout.

## Out of Scope

- Notion-style rich text editing.
- Tiptap / Lexical / ProseMirror integration.
- Code syntax highlighting.
- LaTeX / math rendering.
- JSON persistence implementation.
- AI streaming implementation.

## Architecture Rules

- Store remains the single source of truth.
- Markdown normalization is display-only and must not mutate stored text.
- Right sidebar textarea stays a plain editing surface.
- Canvas card remains the Markdown preview surface.

## Acceptance Criteria

- `> 天气\n> 不错` renders as a blockquote with two visible lines.
- Links are blue and underlined.
- h1-h6 render without breaking compact card layout.
- Markdown tables render with styled cells and horizontal scrolling when needed.
- TypeScript check passes.
