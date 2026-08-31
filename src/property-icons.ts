export type PropertyIconId = string;
export type PropertyIcons = Record<string, PropertyIconId>;

export function normalizePropertyIcons(value: unknown): PropertyIcons {
	if (!isRecord(value)) return {};

	const result: PropertyIcons = {};
	for (const [propertyName, iconId] of Object.entries(value)) {
		const normalizedName = propertyName.trim();
		if (!normalizedName || typeof iconId !== "string") continue;

		const normalizedIconId = iconId.trim();
		if (!normalizedIconId || normalizedIconId === "auto" || normalizedIconId === "null") continue;
		result[normalizedName] = normalizedIconId;
	}
	return result;
}

export function getPropertyIcon(
	propertyIcons: PropertyIcons | undefined,
	propertyName: string | undefined
): PropertyIconId | undefined {
	if (!propertyIcons || !propertyName) return undefined;
	const iconId = propertyIcons[propertyName];
	return typeof iconId === "string" && iconId.length > 0 ? iconId : undefined;
}

export function setPropertyIcon(
	propertyIcons: PropertyIcons,
	propertyName: string,
	iconId: string
): PropertyIcons {
	const next = { ...propertyIcons };
	const normalizedName = propertyName.trim();
	const normalizedIconId = iconId.trim();
	if (!normalizedName || !normalizedIconId || normalizedIconId === "auto" || normalizedIconId === "null") {
		return next;
	}

	next[normalizedName] = normalizedIconId;
	return next;
}

export function resetPropertyIcon(
	propertyIcons: PropertyIcons,
	propertyName: string
): PropertyIcons {
	const next = { ...propertyIcons };
	delete next[propertyName];
	return next;
}

export function mergePropertyIconNames(
	vaultPropertyNames: Iterable<string>,
	configuredPropertyNames: Iterable<string>
): string[] {
	const names = new Set<string>();
	for (const propertyName of [...vaultPropertyNames, ...configuredPropertyNames]) {
		const normalizedName = propertyName.trim();
		if (normalizedName) names.add(normalizedName);
	}
	return Array.from(names).sort((left, right) => left.localeCompare(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
