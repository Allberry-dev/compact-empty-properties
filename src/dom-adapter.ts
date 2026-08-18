import {
	classifyDomValue,
	DomValueState,
	DomValueSnapshot,
	isEmptyPropertyValue
} from "./empty-state";

export const METADATA_CONTAINER_SELECTOR = ".metadata-container";
export const PROPERTY_ROW_SELECTOR = ".metadata-property";
export const PROPERTY_KEY_SELECTOR = ".metadata-property-key";
export const PROPERTY_VALUE_SELECTOR = ".metadata-property-value";
export const HIDDEN_CLASS = "compact-empty-properties-hidden";
export const TOGGLE_CLASS = "compact-empty-properties-toggle";

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
