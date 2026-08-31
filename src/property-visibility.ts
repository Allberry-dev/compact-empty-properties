export type PropertyVisibility = "auto" | "show" | "hide";
export type ScopedPropertyVisibility = Exclude<PropertyVisibility, "auto">;
export type ScopedRuleScope = "notes" | "folders";
import {
	normalizePropertyIcons,
	type PropertyIcons
} from "./property-icons.ts";

export type ScopedPropertyVisibilityMap = Record<
	string,
	Record<string, ScopedPropertyVisibility>
>;

export interface ScopedPropertyVisibilitySettings {
	notes: ScopedPropertyVisibilityMap;
	folders: ScopedPropertyVisibilityMap;
}

export interface ManualHideOrderSettings {
	next: number;
	vault: Record<string, number>;
	notes: Record<string, Record<string, number>>;
	folders: Record<string, Record<string, number>>;
}

export interface CompactEmptyPropertiesSettings {
	hideEmptyProperties: boolean;
	propertyVisibility: Record<string, PropertyVisibility>;
	scopedPropertyVisibility: ScopedPropertyVisibilitySettings;
	manualHideOrder: ManualHideOrderSettings;
	propertyIcons: PropertyIcons;
	propertyOrder: string[];
	scopedPropertyOrder: {
		folders: Record<string, string[]>;
	};
}

export type VisibilitySource = "note" | "folder" | "vault" | "auto";

export interface PropertyVisibilityResolution {
	visibility: PropertyVisibility;
	source: VisibilitySource;
	folderPath?: string;
}

export interface PropertyVisibilityDecision {
	visibility: PropertyVisibility;
	compactEnabled: boolean;
	expanded: boolean;
	revealActive?: boolean;
	empty: boolean;
	editing: boolean;
	newlyCreated: boolean;
}

export interface ScopedRuleMigrationResult {
	settings: CompactEmptyPropertiesSettings;
	changed: boolean;
}

export const DEFAULT_SETTINGS: CompactEmptyPropertiesSettings = {
	hideEmptyProperties: true,
	propertyVisibility: {},
	scopedPropertyVisibility: {
		notes: {},
		folders: {}
	},
	manualHideOrder: {
		next: 1,
		vault: {},
		notes: {},
		folders: {}
	},
	propertyIcons: {},
	propertyOrder: [],
	scopedPropertyOrder: {
		folders: {}
	}
};

export const PROPERTY_VISIBILITY_MODES: readonly PropertyVisibility[] = ["auto", "show", "hide"];
export const SCOPED_PROPERTY_VISIBILITY_MODES: readonly ScopedPropertyVisibility[] = ["show", "hide"];

export function isPropertyVisibility(value: unknown): value is PropertyVisibility {
	return value === "auto" || value === "show" || value === "hide";
}

export function isScopedPropertyVisibility(value: unknown): value is ScopedPropertyVisibility {
	return value === "show" || value === "hide";
}

export function normalizeVaultPath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.split("/")
		.filter((part) => part.length > 0 && part !== ".")
		.join("/");
}

export function normalizeSettings(data: unknown): CompactEmptyPropertiesSettings {
	const source = isRecord(data) ? data : {};
	const propertyVisibility: Record<string, PropertyVisibility> = {};
	const storedVisibility = isRecord(source.propertyVisibility) ? source.propertyVisibility : {};

	for (const [propertyName, visibility] of Object.entries(storedVisibility)) {
		if (isPropertyVisibility(visibility)) propertyVisibility[propertyName] = visibility;
	}

	const scopedSource = isRecord(source.scopedPropertyVisibility)
		? source.scopedPropertyVisibility
		: {};
	const scopedPropertyVisibility = {
		notes: normalizeScopedMap(scopedSource.notes, false),
		folders: normalizeScopedMap(scopedSource.folders, true)
	};

	return {
		hideEmptyProperties: typeof source.hideEmptyProperties === "boolean"
			? source.hideEmptyProperties
			: DEFAULT_SETTINGS.hideEmptyProperties,
		propertyVisibility,
		scopedPropertyVisibility,
		manualHideOrder: normalizeManualHideOrder(
			source.manualHideOrder,
			propertyVisibility,
			scopedPropertyVisibility
		),
		propertyIcons: normalizePropertyIcons(source.propertyIcons),
		propertyOrder: normalizePropertyOrderList(source.propertyOrder),
		scopedPropertyOrder: normalizeScopedPropertyOrder(source.scopedPropertyOrder)
	};
}

export function getPropertyVisibility(
	propertyVisibility: Record<string, PropertyVisibility> | undefined,
	propertyName: string | undefined
): PropertyVisibility {
	if (!propertyVisibility || propertyName === undefined) return "auto";
	const visibility = propertyVisibility[propertyName];
	return isPropertyVisibility(visibility) ? visibility : "auto";
}

export type ManualHideOrderScope = ScopedRuleScope | "vault";

export function getManualHideSequence(
	settings: CompactEmptyPropertiesSettings,
	notePath: string,
	propertyName: string | undefined,
	resolution: PropertyVisibilityResolution
): number {
	if (!propertyName || resolution.visibility !== "hide") return 0;
	if (resolution.source === "vault") {
		return settings.manualHideOrder.vault[propertyName] ?? 0;
	}
	if (resolution.source === "note") {
		return settings.manualHideOrder.notes[normalizeVaultPath(notePath)]?.[propertyName] ?? 0;
	}
	if (resolution.source === "folder" && resolution.folderPath) {
		return settings.manualHideOrder.folders[resolution.folderPath]?.[propertyName] ?? 0;
	}
	return 0;
}

function setManualHideSequence(
	settings: CompactEmptyPropertiesSettings,
	scope: ManualHideOrderScope,
	scopePath: string,
	propertyName: string
): void {
	const sequence = Math.max(1, settings.manualHideOrder.next);
	settings.manualHideOrder.next = sequence + 1;
	const target = getManualHideOrderMap(settings, scope, scopePath);
	if (target) target[propertyName] = sequence;
}

function clearManualHideSequence(
	settings: CompactEmptyPropertiesSettings,
	scope: ManualHideOrderScope,
	scopePath: string,
	propertyName: string
): void {
	const target = getManualHideOrderMap(settings, scope, scopePath);
	if (!target) return;
	delete target[propertyName];
	deleteEmptyManualHideMap(settings, scope, scopePath);
}

function getManualHideOrderMap(
	settings: CompactEmptyPropertiesSettings,
	scope: ManualHideOrderScope,
	scopePath: string
): Record<string, number> | undefined {
	if (scope === "vault") return settings.manualHideOrder.vault;
	const path = normalizeVaultPath(scopePath);
	if (!path) return undefined;
	return settings.manualHideOrder[scope][path] ??= {};
}

function deleteEmptyManualHideMap(
	settings: CompactEmptyPropertiesSettings,
	scope: ManualHideOrderScope,
	scopePath: string
): void {
	if (scope === "vault") return;
	const path = normalizeVaultPath(scopePath);
	if (!path) return;
	const map = settings.manualHideOrder[scope][path];
	if (map && Object.keys(map).length === 0) delete settings.manualHideOrder[scope][path];
}

export function setVaultRule(
	settings: CompactEmptyPropertiesSettings,
	propertyName: string,
	visibility: PropertyVisibility
): CompactEmptyPropertiesSettings {
	const next = cloneSettings(settings);
	if (!propertyName || !isPropertyVisibility(visibility)) return next;
	next.propertyVisibility[propertyName] = visibility;
	if (visibility === "hide") setManualHideSequence(next, "vault", "", propertyName);
	else clearManualHideSequence(next, "vault", "", propertyName);
	return next;
}

export function getScopedRule(
	settings: CompactEmptyPropertiesSettings,
	scope: ScopedRuleScope,
	scopePath: string,
	propertyName: string | undefined
): ScopedPropertyVisibility | undefined {
	if (!propertyName) return undefined;
	const path = normalizeVaultPath(scopePath);
	if (!path) return undefined;
	const rule = settings.scopedPropertyVisibility[scope][path]?.[propertyName];
	return isScopedPropertyVisibility(rule) ? rule : undefined;
}

export function hasVaultRule(
	settings: CompactEmptyPropertiesSettings,
	propertyName: string | undefined
): boolean {
	return propertyName !== undefined &&
		Object.prototype.hasOwnProperty.call(settings.propertyVisibility, propertyName);
}

export function getContainingFolder(notePath: string): string {
	const normalized = normalizeVaultPath(notePath);
	const separator = normalized.lastIndexOf("/");
	return separator === -1 ? "" : normalized.slice(0, separator);
}

export function isPathWithinFolder(notePath: string, folderPath: string): boolean {
	const note = normalizeVaultPath(notePath);
	const folder = normalizeVaultPath(folderPath);
	return folder.length > 0 && (note === folder || note.startsWith(`${folder}/`));
}

export function getMostSpecificFolderRule(
	settings: CompactEmptyPropertiesSettings,
	notePath: string,
	propertyName: string | undefined
): { folderPath: string; visibility: ScopedPropertyVisibility } | undefined {
	if (!propertyName) return undefined;
	let best: { folderPath: string; visibility: ScopedPropertyVisibility } | undefined;
	for (const [folderPath, rules] of Object.entries(settings.scopedPropertyVisibility.folders)) {
		if (!isPathWithinFolder(notePath, folderPath)) continue;
		const visibility = rules[propertyName];
		if (!isScopedPropertyVisibility(visibility)) continue;
		if (!best || folderPath.length > best.folderPath.length) {
			best = { folderPath, visibility };
		}
	}
	return best;
}

/**
 * Resolves the effective rule in the fixed order: note, most-specific folder,
 * vault, then the existing Auto behavior.
 */
export function resolvePropertyVisibility(
	settings: CompactEmptyPropertiesSettings,
	notePath: string,
	propertyName: string | undefined
): PropertyVisibilityResolution {
	if (!propertyName) return { visibility: "auto", source: "auto" };

	const noteRule = getScopedRule(settings, "notes", notePath, propertyName);
	if (noteRule) return { visibility: noteRule, source: "note" };

	const folderRule = getMostSpecificFolderRule(settings, notePath, propertyName);
	if (folderRule) {
		return {
			visibility: folderRule.visibility,
			source: "folder",
			folderPath: folderRule.folderPath
		};
	}

	const vaultRule = getPropertyVisibility(settings.propertyVisibility, propertyName);
	if (vaultRule !== "auto") return { visibility: vaultRule, source: "vault" };
	return { visibility: "auto", source: "auto" };
}

export function setScopedRule(
	settings: CompactEmptyPropertiesSettings,
	scope: ScopedRuleScope,
	scopePath: string,
	propertyName: string,
	visibility: ScopedPropertyVisibility
): CompactEmptyPropertiesSettings {
	const path = normalizeVaultPath(scopePath);
	if (!path || !propertyName || !isScopedPropertyVisibility(visibility)) return cloneSettings(settings);

	const next = cloneSettings(settings);
	next.scopedPropertyVisibility[scope][path] = {
		...(next.scopedPropertyVisibility[scope][path] ?? {}),
		[propertyName]: visibility
	};
	if (visibility === "hide") setManualHideSequence(next, scope, path, propertyName);
	else clearManualHideSequence(next, scope, path, propertyName);
	return next;
}

export function resetScopedRule(
	settings: CompactEmptyPropertiesSettings,
	scope: ScopedRuleScope,
	scopePath: string,
	propertyName: string
): CompactEmptyPropertiesSettings {
	const path = normalizeVaultPath(scopePath);
	const next = cloneSettings(settings);
	if (!path || !propertyName) return next;

	const rules = next.scopedPropertyVisibility[scope][path];
	if (rules) {
		delete rules[propertyName];
		if (Object.keys(rules).length === 0) delete next.scopedPropertyVisibility[scope][path];
	}
	clearManualHideSequence(next, scope, path, propertyName);
	return next;
}

export function resetVaultRule(
	settings: CompactEmptyPropertiesSettings,
	propertyName: string
): CompactEmptyPropertiesSettings {
	const next = cloneSettings(settings);
	delete next.propertyVisibility[propertyName];
	clearManualHideSequence(next, "vault", "", propertyName);
	return next;
}

export function migrateNoteRulePath(
	settings: CompactEmptyPropertiesSettings,
	oldPath: string,
	newPath: string
): ScopedRuleMigrationResult {
	const oldKey = normalizeVaultPath(oldPath);
	const newKey = normalizeVaultPath(newPath);
	if (!oldKey || !newKey || oldKey === newKey) return { settings, changed: false };

	const source = settings.scopedPropertyVisibility.notes[oldKey];
	if (!source) return { settings, changed: false };

	const next = cloneSettings(settings);
	const destination = next.scopedPropertyVisibility.notes[newKey] ?? {};
	const mergedRules = mergeRuleMaps(destination, source);
	next.scopedPropertyVisibility.notes[newKey] = mergedRules;
	const mergedOrder = mergeManualHideOrderMaps(
		next.manualHideOrder.notes[newKey] ?? {},
		next.manualHideOrder.notes[oldKey] ?? {},
		mergedRules
	);
	assignManualHideOrderMap(next.manualHideOrder.notes, newKey, mergedOrder);
	delete next.scopedPropertyVisibility.notes[oldKey];
	delete next.manualHideOrder.notes[oldKey];
	return { settings: next, changed: true };
}

export function migrateFolderRulePath(
	settings: CompactEmptyPropertiesSettings,
	oldPath: string,
	newPath: string
): ScopedRuleMigrationResult {
	const oldKey = normalizeVaultPath(oldPath);
	const newKey = normalizeVaultPath(newPath);
	if (!oldKey || !newKey || oldKey === newKey) return { settings, changed: false };

	const sourceEntries = Object.entries(settings.scopedPropertyVisibility.folders)
		.filter(([folderPath]) => folderPath === oldKey || folderPath.startsWith(`${oldKey}/`));
	if (sourceEntries.length === 0) return { settings, changed: false };

	const next = cloneSettings(settings);
	for (const [folderPath] of sourceEntries) delete next.scopedPropertyVisibility.folders[folderPath];
	const sourceOrders = new Map(sourceEntries.map(([folderPath]) => [
		folderPath,
		{ ...(next.manualHideOrder.folders[folderPath] ?? {}) }
	]));
	for (const [folderPath] of sourceEntries) delete next.manualHideOrder.folders[folderPath];

	for (const [folderPath, sourceRules] of sourceEntries) {
		const suffix = folderPath === oldKey ? "" : folderPath.slice(oldKey.length);
		const destinationPath = normalizeVaultPath(`${newKey}${suffix}`);
		const destination = next.scopedPropertyVisibility.folders[destinationPath] ?? {};
		const mergedRules = mergeRuleMaps(destination, sourceRules);
		next.scopedPropertyVisibility.folders[destinationPath] = mergedRules;
		const mergedOrder = mergeManualHideOrderMaps(
			next.manualHideOrder.folders[destinationPath] ?? {},
			sourceOrders.get(folderPath) ?? {},
			mergedRules
		);
		assignManualHideOrderMap(next.manualHideOrder.folders, destinationPath, mergedOrder);
	}
	return { settings: next, changed: true };
}

export function migrateNoteRulesUnderFolderPath(
	settings: CompactEmptyPropertiesSettings,
	oldPath: string,
	newPath: string
): ScopedRuleMigrationResult {
	const oldKey = normalizeVaultPath(oldPath);
	const newKey = normalizeVaultPath(newPath);
	if (!oldKey || !newKey || oldKey === newKey) return { settings, changed: false };

	const sourceEntries = Object.entries(settings.scopedPropertyVisibility.notes)
		.filter(([notePath]) => notePath.startsWith(`${oldKey}/`));
	if (sourceEntries.length === 0) return { settings, changed: false };

	const next = cloneSettings(settings);
	for (const [notePath] of sourceEntries) delete next.scopedPropertyVisibility.notes[notePath];
	const sourceOrders = new Map(sourceEntries.map(([notePath]) => [
		notePath,
		{ ...(next.manualHideOrder.notes[notePath] ?? {}) }
	]));
	for (const [notePath] of sourceEntries) delete next.manualHideOrder.notes[notePath];

	for (const [notePath, sourceRules] of sourceEntries) {
		const suffix = notePath.slice(oldKey.length);
		const destinationPath = normalizeVaultPath(`${newKey}${suffix}`);
		const destination = next.scopedPropertyVisibility.notes[destinationPath] ?? {};
		const mergedRules = mergeRuleMaps(destination, sourceRules);
		next.scopedPropertyVisibility.notes[destinationPath] = mergedRules;
		const mergedOrder = mergeManualHideOrderMaps(
			next.manualHideOrder.notes[destinationPath] ?? {},
			sourceOrders.get(notePath) ?? {},
			mergedRules
		);
		assignManualHideOrderMap(next.manualHideOrder.notes, destinationPath, mergedOrder);
	}
	return { settings: next, changed: true };
}

/**
 * Visibility reveal is an in-memory UI override. It intentionally precedes
 * all persisted rules, including forced hide.
 */
export function shouldHideProperty(decision: PropertyVisibilityDecision): boolean {
	if (decision.revealActive) return false;
	if (decision.visibility === "hide") return true;
	if (decision.visibility === "show") return false;
	return decision.compactEnabled && !decision.expanded && decision.empty &&
		!decision.editing && !decision.newlyCreated;
}

function normalizeScopedMap(value: unknown, isFolder: boolean): ScopedPropertyVisibilityMap {
	const result: ScopedPropertyVisibilityMap = {};
	if (!isRecord(value)) return result;

	for (const [rawPath, rawRules] of Object.entries(value)) {
		const path = normalizeVaultPath(rawPath);
		if (!path || (isFolder && path.length === 0) || !isRecord(rawRules)) continue;
		const rules: Record<string, ScopedPropertyVisibility> = {};
		for (const [propertyName, visibility] of Object.entries(rawRules)) {
			// Scoped Auto is deliberately not persisted: absence means inherit.
			if (isScopedPropertyVisibility(visibility)) rules[propertyName] = visibility;
		}
		if (Object.keys(rules).length > 0) result[path] = rules;
	}
	return result;
}

function normalizeManualHideOrder(
	value: unknown,
	propertyVisibility: Record<string, PropertyVisibility>,
	scopedPropertyVisibility: ScopedPropertyVisibilitySettings
): ManualHideOrderSettings {
	const source = isRecord(value) ? value : {};
	const vault = normalizeManualHideMap(source.vault, propertyVisibility);
	const notes = normalizeManualHidePathMap(
		source.notes,
		scopedPropertyVisibility.notes
	);
	const folders = normalizeManualHidePathMap(
		source.folders,
		scopedPropertyVisibility.folders
	);
	const maximum = Math.max(
		0,
		...Object.values(vault),
		...Object.values(notes).flatMap((rules) => Object.values(rules)),
		...Object.values(folders).flatMap((rules) => Object.values(rules))
	);
	const storedNext = typeof source.next === "number" && Number.isSafeInteger(source.next)
		? source.next
		: 1;
	return {
		next: Math.max(1, storedNext, maximum + 1),
		vault,
		notes,
		folders
	};
}

function normalizeManualHideMap(
	value: unknown,
	rules: Record<string, PropertyVisibility>
): Record<string, number> {
	if (!isRecord(value)) return {};
	const result: Record<string, number> = {};
	for (const [propertyName, sequence] of Object.entries(value)) {
		if (rules[propertyName] !== "hide" || !isSequence(sequence)) continue;
		result[propertyName] = sequence;
	}
	return result;
}

function normalizeManualHidePathMap(
	value: unknown,
	rules: ScopedPropertyVisibilityMap
): Record<string, Record<string, number>> {
	if (!isRecord(value)) return {};
	const result: Record<string, Record<string, number>> = {};
	for (const [rawPath, rawOrder] of Object.entries(value)) {
		const path = normalizeVaultPath(rawPath);
		const pathRules = rules[path];
		if (!path || !pathRules || !isRecord(rawOrder)) continue;
		const normalized = normalizeManualHideMap(rawOrder, pathRules);
		if (Object.keys(normalized).length > 0) result[path] = normalized;
	}
	return result;
}

function isSequence(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function mergeRuleMaps(
	destination: Record<string, ScopedPropertyVisibility>,
	source: Record<string, ScopedPropertyVisibility>
): Record<string, ScopedPropertyVisibility> {
	// Destination wins on conflict; source contributes only missing properties.
	return { ...source, ...destination };
}

function mergeManualHideOrderMaps(
	destination: Record<string, number>,
	source: Record<string, number>,
	destinationRules: Record<string, ScopedPropertyVisibility>
): Record<string, number> {
	const merged = { ...source, ...destination };
	const result: Record<string, number> = {};
	for (const [propertyName, sequence] of Object.entries(merged)) {
		if (destinationRules[propertyName] === "hide" && isSequence(sequence)) {
			result[propertyName] = sequence;
		}
	}
	return result;
}

function assignManualHideOrderMap(
	target: Record<string, Record<string, number>>,
	path: string,
	order: Record<string, number>
): void {
	if (Object.keys(order).length > 0) target[path] = order;
	else delete target[path];
}

function cloneSettings(settings: CompactEmptyPropertiesSettings): CompactEmptyPropertiesSettings {
	return {
		hideEmptyProperties: settings.hideEmptyProperties,
		propertyVisibility: { ...settings.propertyVisibility },
		scopedPropertyVisibility: {
			notes: cloneRuleMap(settings.scopedPropertyVisibility.notes),
			folders: cloneRuleMap(settings.scopedPropertyVisibility.folders)
		},
		manualHideOrder: {
			next: settings.manualHideOrder.next,
			vault: { ...settings.manualHideOrder.vault },
			notes: cloneOrderMap(settings.manualHideOrder.notes),
			folders: cloneOrderMap(settings.manualHideOrder.folders)
		},
		propertyIcons: { ...settings.propertyIcons },
		propertyOrder: [...settings.propertyOrder],
		scopedPropertyOrder: {
			folders: clonePropertyOrderMap(settings.scopedPropertyOrder.folders)
		}
	};
}

function cloneRuleMap(source: ScopedPropertyVisibilityMap): ScopedPropertyVisibilityMap {
	const result: ScopedPropertyVisibilityMap = {};
	for (const [path, rules] of Object.entries(source)) result[path] = { ...rules };
	return result;
}

function cloneOrderMap(source: Record<string, Record<string, number>>): Record<string, Record<string, number>> {
	const result: Record<string, Record<string, number>> = {};
	for (const [path, order] of Object.entries(source)) result[path] = { ...order };
	return result;
}

function normalizePropertyOrderList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const result: string[] = [];
	const seen = new Set<string>();
	for (const propertyName of value) {
		if (typeof propertyName !== "string") continue;
		const normalized = propertyName.trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}
	return result;
}

function normalizeScopedPropertyOrder(value: unknown): { folders: Record<string, string[]> } {
	const source = isRecord(value) ? value : {};
	const foldersSource = isRecord(source.folders) ? source.folders : {};
	const folders: Record<string, string[]> = {};
	for (const [rawPath, rawOrder] of Object.entries(foldersSource)) {
		const path = normalizeVaultPath(rawPath);
		const order = normalizePropertyOrderList(rawOrder);
		if (path && order.length > 0) folders[path] = order;
	}
	return { folders };
}

function clonePropertyOrderMap(source: Record<string, string[]>): Record<string, string[]> {
	const result: Record<string, string[]> = {};
	for (const [path, order] of Object.entries(source)) result[path] = [...order];
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
