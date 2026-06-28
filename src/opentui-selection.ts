import {
	ASCIIFontRenderable,
	CodeRenderable,
	MarkdownRenderable,
	TextRenderable,
	TextareaRenderable,
} from "@opentui/core"
import { extend } from "@opentui/solid"

function forceNonSelectable<TBase extends new (...args: any[]) => { selectable?: boolean }>(Base: TBase) {
	return class NonSelectableRenderable extends Base {
		constructor(...args: any[]) {
			super(...args)
			this.selectable = false
		}
	} as TBase
}

export function disableOpenTuiSelection(): void {
	extend({
		text: forceNonSelectable(TextRenderable),
		textarea: forceNonSelectable(TextareaRenderable),
		code: forceNonSelectable(CodeRenderable),
		markdown: forceNonSelectable(MarkdownRenderable),
		ascii_font: forceNonSelectable(ASCIIFontRenderable),
	})
}
