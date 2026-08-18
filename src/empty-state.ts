export type DomValueState = "empty" | "non-empty" | "unknown";

export interface DomValueSnapshot {
	emptyMarker?: boolean;
	inputKind?: "checkbox" | "text" | "other";
	inputValue?: string;
	checked?: boolean;
	textContent?: string;
	contentEditableText?: string;
	hasContentEditable?: boolean;
	hasChips?: boolean;
	propertyType?: string;
}

/**
 * Empty is deliberately structural. In particular, false and 0 are values,
 * not empty placeholders.
 */
export function isEmptyPropertyValue(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	if (typeof value === "string") return value.length === 0;
	if (Array.isArray(value)) return value.length === 0;
	if (isPlainObject(value)) return Object.keys(value).length === 0;
	return false;
}

export function classifyDomValue(snapshot: DomValueSnapshot): DomValueState {
	if (snapshot.emptyMarker === true) return "empty";

	// A checkbox with checked=false is still a real Boolean property value.
	if (snapshot.inputKind === "checkbox") return "non-empty";

	if (snapshot.hasChips === true) return "non-empty";

	if (snapshot.inputKind === "text") {
		return snapshot.inputValue?.trim() ? "non-empty" : "empty";
	}

	if (snapshot.hasContentEditable) {
		return classifyText(snapshot.contentEditableText);
	}

	if (snapshot.textContent !== undefined) {
		const text = snapshot.textContent.trim();
		if (text === "" || text.toLowerCase() === "null") return "empty";
		if ((snapshot.propertyType === "list" && text === "[]") ||
			(snapshot.propertyType === "object" && text === "{}")) {
			return "empty";
		}
		return "non-empty";
	}

	if (snapshot.hasChips === false) return "empty";

	return "unknown";
}

export interface VisibilityRow {
	id: string;
	value: unknown;
	editing?: boolean;
	justCreated?: boolean;
}

export function hiddenRowIds(
	rows: readonly VisibilityRow[],
	enabled: boolean,
	expanded: boolean
): string[] {
	if (!enabled || expanded) return [];
	return rows
		.filter((row) => !row.editing && !row.justCreated && isEmptyPropertyValue(row.value))
		.map((row) => row.id);
}

export function emptyRowCount(rows: readonly VisibilityRow[]): number {
	return rows.filter((row) => isEmptyPropertyValue(row.value)).length;
}

export function toggleText(expanded: boolean, hiddenCount: number): string {
	return expanded ? "隐藏空属性" : `显示空属性 (${hiddenCount})`;
}

function classifyText(text: string | undefined): DomValueState {
	if (text === undefined) return "unknown";
	const normalized = text.trim();
	return normalized === "" || normalized.toLowerCase() === "null"
		? "empty"
		: "non-empty";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
