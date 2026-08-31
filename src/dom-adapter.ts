import {
	classifyDomValue,
	DomValueState,
	DomValueSnapshot,
	isEmptyPropertyValue
} from "./empty-state";

export const METADATA_CONTAINER_SELECTOR = ".metadata-container";
export const PROPERTY_ROW_SELECTOR = ".metadata-property";
export const PROPERTY_KEY_SELECTOR = ".metadata-property-key";
export const NATIVE_PROPERTY_ICON_SELECTOR = ".metadata-property-icon";
export const PROPERTY_VALUE_SELECTOR = ".metadata-property-value";
export const HIDDEN_CLASS = "compact-empty-properties-hidden";
export const REVEALED_HIDDEN_CLASS = "compact-empty-properties-revealed-hidden";
export const REVEAL_SEPARATOR_CLASS = "compact-empty-properties-reveal-separator";
export const REVEAL_GROUP_LABEL_CLASS = "compact-empty-properties-reveal-group-label";
export const REVEAL_AUTO_SEPARATOR_CLASS = "compact-empty-properties-reveal-auto-separator";
export const TOGGLE_CLASS = "compact-empty-properties-toggle";
export const CUSTOM_PROPERTY_ICON_CLASS = "cep-property-custom-icon";
export const REORDER_BAR_CLASS = "compact-empty-properties-reorder-bar";
export const REORDER_HANDLE_CLASS = "compact-empty-properties-reorder-handle";
export const REORDER_DRAGGING_CLASS = "compact-empty-properties-reorder-dragging";

export function getPropertyRows(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(PROPERTY_ROW_SELECTOR));
}

export function getPropertyKey(row: HTMLElement): string | undefined {
	const directKey = row.getAttribute("data-property-key") ??
		row.querySelector(PROPERTY_KEY_SELECTOR)?.getAttribute("data-property-key");
	if (directKey?.trim()) return directKey.trim();

	const label = row.querySelector(`${PROPERTY_KEY_SELECTOR} label`);
	const visibleKey = label?.textContent ?? row.querySelector(PROPERTY_KEY_SELECTOR)?.textContent;
	return visibleKey?.trim() || undefined;
}

/**
 * Finds the direct child of the Property key container that owns the native
 * editable key control. Keeping CEP's icon beside that child prevents it
 * from being inserted into an Obsidian-owned input/contenteditable wrapper.
 */
export function getPropertyKeyEditableAnchor(propertyKey: HTMLElement): HTMLElement | undefined {
	const editable = propertyKey.querySelector<HTMLElement>("input, [contenteditable=true]");
	if (!editable) {
		return Array.from(propertyKey.children)
			.find((child): child is HTMLElement =>
				child instanceof HTMLElement &&
				!child.matches(NATIVE_PROPERTY_ICON_SELECTOR) &&
				!child.classList.contains(CUSTOM_PROPERTY_ICON_CLASS)
			);
	}

	let anchor: HTMLElement = editable;
	while (anchor.parentElement && anchor.parentElement !== propertyKey) {
		anchor = anchor.parentElement;
	}
	return anchor;
}

/**
 * Returns the direct child of the key container that owns Obsidian's native
 * Property type icon. CEP never replaces this node; it only uses it as an
 * ordering anchor for its own controls.
 */
export function getNativePropertyIconAnchor(propertyKey: HTMLElement): HTMLElement | undefined {
	const nativeIcon = propertyKey.querySelector<HTMLElement>(NATIVE_PROPERTY_ICON_SELECTOR);
	if (!nativeIcon) return undefined;

	let anchor: HTMLElement = nativeIcon;
	while (anchor.parentElement && anchor.parentElement !== propertyKey) {
		anchor = anchor.parentElement;
	}
	return anchor.parentElement === propertyKey ? anchor : undefined;
}

/**
 * Finds the insertion point for CEP's decorative icon. With Obsidian's native
 * icon present, the result is after that icon and before the editable key
 * control. Without a native icon, it remains immediately before the editable
 * control (or the first child fallback used by older DOM variants).
 */
export function getCustomPropertyIconAnchor(propertyKey: HTMLElement): HTMLElement | undefined {
	const nativeIcon = getNativePropertyIconAnchor(propertyKey);
	const editable = getPropertyKeyEditableAnchor(propertyKey);
	if (!nativeIcon) return editable;

	const children = Array.from(propertyKey.children);
	const nativeIndex = children.indexOf(nativeIcon);
	const editableIndex = editable ? children.indexOf(editable) : -1;
	if (editableIndex > nativeIndex) return editable;
	return children
		.slice(nativeIndex + 1)
		.find((child): child is HTMLElement =>
			child instanceof HTMLElement && !child.classList.contains(CUSTOM_PROPERTY_ICON_CLASS)
		);
}

export function getDomValueState(row: HTMLElement): DomValueState {
	const valueElement = row.querySelector<HTMLElement>(PROPERTY_VALUE_SELECTOR);
	if (!valueElement) return "unknown";

	const emptyMarker = valueElement.matches(
		".is-empty, .metadata-property-value-empty, [data-empty=true]"
	);
	if (emptyMarker) return "empty";

	const hasChips = valueElement.querySelector(
		".multi-select-pill, .metadata-property-value-list-item, [data-property-value-chip]"
	) !== null;
	if (hasChips) return "non-empty";

	const checkbox = valueElement.querySelector<HTMLInputElement>("input[type=checkbox]");
	if (checkbox) {
		return classifyDomValue({ inputKind: "checkbox", checked: checkbox.checked });
	}

	const input = valueElement.querySelector<HTMLInputElement>("input, textarea");
	if (input) {
		return classifyDomValue({ inputKind: "text", inputValue: input.value });
	}

	const contentEditable = valueElement.querySelector<HTMLElement>("[contenteditable=true]");
	if (contentEditable) {
		return classifyDomValue({
			hasContentEditable: true,
			contentEditableText: contentEditable.textContent ?? ""
		});
	}

	const propertyType = valueElement.getAttribute("data-type") ?? undefined;
	const looksLikeList = propertyType === "list" || propertyType === "multitext" ||
		valueElement.querySelector(".metadata-property-value-list") !== null;

	const snapshot: DomValueSnapshot = {
		textContent: valueElement.textContent ?? "",
		propertyType
	};
	if (looksLikeList) snapshot.hasChips = hasChips;
	return classifyDomValue(snapshot);
}

export function isRowEmpty(
	row: HTMLElement,
	cacheValue: unknown,
	hasCachedValue: boolean
): boolean {
	const domState = getDomValueState(row);
	if (domState !== "unknown") return domState === "empty";

	// Arrays and objects are read from the metadata cache when their editor
	// representation contains no reliable signal.
	if (hasCachedValue && isStructuredValue(cacheValue)) {
		return isEmptyPropertyValue(cacheValue);
	}
	return hasCachedValue ? isEmptyPropertyValue(cacheValue) : false;
}

export function isRowEditing(row: HTMLElement): boolean {
	if (row.dataset.cepEditing === "true") return true;
	const activeElement = row.ownerDocument.activeElement;
	return activeElement instanceof Node && row.contains(activeElement);
}

function isStructuredValue(value: unknown): boolean {
	return Array.isArray(value) || (
		typeof value === "object" && value !== null
	);
}
