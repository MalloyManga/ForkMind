import { ArrowShapeUtil, type TLArrowShape } from "tldraw"

/**
 * ForkMind 自定义箭头 shape util。
 * 业务场景：箭头只用于表达业务关系，允许选中和删除，但不允许通过 handle 改端点。
 */
export class ForkMindArrowShapeUtil extends ArrowShapeUtil {
    override component(shape: TLArrowShape) {
        const content = super.component(shape)
        const isSelected = this.editor.getSelectedShapeIds().includes(shape.id)

        if (!isSelected) {
            return content
        }

        /**
         * 业务场景：用户选中箭头时，不改箭头本色，而是在外沿额外叠一层黑色阴影，形成“描边反馈”。
         */
        return (
            <g style={{ filter: "drop-shadow(0 0 1px rgba(9, 9, 11, 0.95)) drop-shadow(0 0 1px rgba(9, 9, 11, 0.95))" }}>
                {content}
            </g>
        )
    }
}
