export interface PropertyOrderSettings {
	propertyOrder: string[];
	scopedPropertyOrder: {
		folders: Record<string, string[]>;
	};
}

export interface PropertyOrderMigrationResult<T extends PropertyOrderSettings> {
	settings: T;
	changed: boolean;
}

export function normalizePropertyOrder(value: unknown): {
	propertyOrder: string[];
	scopedPropertyOrder: { folders: Record<string, string[]> };
} {
	const source = isRecord(value) ? value : {};
	const scopedSource = isRecord(source.scopedPropertyOrder)
		? source.scopedPropertyOrder
		: {};
	const folders: Record<string, string[]> = {};
	const storedFolders = isRecord(scopedSource.folders) ? scopedSource.folders : {};

	for (const [rawPath, rawOrder] of Object.entries(storedFolders)) {
		const path = normalizePath(rawPath);
		const order = normalizeOrderList(rawOrder);
		if (path && order.length > 0) folders[path] = order;
	}

	return {
		propertyOrder: normalizeOrderList(source.propertyOrder),
		scopedPropertyOrder: { folders }
	};
}

export function resolvePropertyOrder(
	settings: PropertyOrderSettings,
	notePath: string,
	nativeOrder: readonly string[]
): string[] {
	const nativeNames = uniqueNames(nativeOrder);
	const available = new Set(nativeNames);
	const resolved: string[] = [];
	const seen = new Set<string>();

	const addOrder = (order: readonly string[]): void => {
		for (const propertyName of order) {
			if (!available.has(propertyName) || seen.has(propertyName)) continue;
			seen.add(propertyName);
			resolved.push(propertyName);
		}
	};

	// Folder paths are returned most-specific first, then parent folders.
	for (const folderPath of getFolderOrderPaths(notePath)) {
		addOrder(settings.scopedPropertyOrder.folders[folderPath] ?? []);
	}
	addOrder(settings.propertyOrder);
	addOrder(nativeNames);
	return resolved;
}

export function getFolderOrderPaths(notePath: string): string[] {
	const normalizedNotePath = normalizePath(notePath);
	const separator = normalizedNotePath.lastIndexOf("/");
	if (separator === -1) return [];

	const folderPath = normalizedNotePath.slice(0, separator);
	const paths: string[] = [];
	let current = folderPath;
	while (current) {
		paths.push(current);
		const parentSeparator = current.lastIndexOf("/");
		current = parentSeparator === -1 ? "" : current.slice(0, parentSeparator);
	}
	return paths;
}

export function setVaultPropertyOrder<T extends PropertyOrderSettings>(
	settings: T,
	order: readonly string[]
): T {
	return {
		...settings,
		propertyOrder: mergeKnownOrder(settings.propertyOrder, order),
		scopedPropertyOrder: cloneScopedPropertyOrder(settings.scopedPropertyOrder)
	} as T;
}

export function resetVaultPropertyOrder<T extends PropertyOrderSettings>(settings: T): T {
	return {
		...settings,
		propertyOrder: [],
		scopedPropertyOrder: cloneScopedPropertyOrder(settings.scopedPropertyOrder)
	} as T;
}

export function setFolderPropertyOrder<T extends PropertyOrderSettings>(
	settings: T,
	folderPath: string,
	order: readonly string[]
): T {
	const path = normalizePath(folderPath);
	if (!path) return clonePropertyOrderSettings(settings);
	const folders = cloneFolderOrders(settings.scopedPropertyOrder.folders);
	folders[path] = mergeKnownOrder(folders[path] ?? [], order);
	return {
		...settings,
		propertyOrder: [...settings.propertyOrder],
		scopedPropertyOrder: { folders }
	} as T;
}

export function resetFolderPropertyOrder<T extends PropertyOrderSettings>(
	settings: T,
	folderPath: string
): T {
	const path = normalizePath(folderPath);
	if (!path) return clonePropertyOrderSettings(settings);
	const folders = cloneFolderOrders(settings.scopedPropertyOrder.folders);
	delete folders[path];
	return {
		...settings,
		propertyOrder: [...settings.propertyOrder],
		scopedPropertyOrder: { folders }
	} as T;
}

export function migrateFolderPropertyOrder<T extends PropertyOrderSettings>(
	settings: T,
	oldPath: string,
	newPath: string
): PropertyOrderMigrationResult<T> {
	const oldKey = normalizePath(oldPath);
	const newKey = normalizePath(newPath);
	if (!oldKey || !newKey || oldKey === newKey) return { settings, changed: false };

	const sourceEntries = Object.entries(settings.scopedPropertyOrder.folders)
		.filter(([folderPath]) => folderPath === oldKey || folderPath.startsWith(`${oldKey}/`));
	if (sourceEntries.length === 0) return { settings, changed: false };

	const folders = cloneFolderOrders(settings.scopedPropertyOrder.folders);
	for (const [folderPath] of sourceEntries) delete folders[folderPath];

	for (const [folderPath, sourceOrder] of sourceEntries) {
		const suffix = folderPath === oldKey ? "" : folderPath.slice(oldKey.length);
		const destinationPath = normalizePath(`${newKey}${suffix}`);
		if (!destinationPath) continue;
		// The destination's existing order keeps its relative precedence. Source
		// names absent at the destination are appended deterministically.
		folders[destinationPath] = mergeKnownOrder(sourceOrder, folders[destinationPath] ?? []);
	}

	return {
		settings: {
			...settings,
			propertyOrder: [...settings.propertyOrder],
			scopedPropertyOrder: { folders }
		} as T,
		changed: true
	};
}

export function mergeKnownOrder(
	existingOrder: readonly string[],
	knownOrder: readonly string[]
): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const propertyName of knownOrder) {
		const normalized = propertyName.trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}
	for (const propertyName of existingOrder) {
		const normalized = propertyName.trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}
	return result;
}

function clonePropertyOrderSettings<T extends PropertyOrderSettings>(settings: T): T {
	return {
		...settings,
		propertyOrder: [...settings.propertyOrder],
		scopedPropertyOrder: cloneScopedPropertyOrder(settings.scopedPropertyOrder)
	} as T;
}

function cloneScopedPropertyOrder(
	scopedPropertyOrder: PropertyOrderSettings["scopedPropertyOrder"]
): PropertyOrderSettings["scopedPropertyOrder"] {
	return { folders: cloneFolderOrders(scopedPropertyOrder.folders) };
}

function cloneFolderOrders(source: Record<string, string[]>): Record<string, string[]> {
	const result: Record<string, string[]> = {};
	for (const [path, order] of Object.entries(source)) result[path] = [...order];
	return result;
}

function normalizeOrderList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return mergeKnownOrder([], value.filter((propertyName): propertyName is string => typeof propertyName === "string"));
}

function uniqueNames(names: readonly string[]): string[] {
	return mergeKnownOrder([], names);
}

function normalizePath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.split("/")
		.filter((part) => part.length > 0 && part !== ".")
		.join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
