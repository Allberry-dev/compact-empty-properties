import {
	App,
	getIcon,
	getIconIds,
	Menu,
	MarkdownView,
	Modal,
	Plugin,
	PluginSettingTab,
	Setting,
	setIcon,
	TFile,
	TFolder,
	type IconName,
	type SettingDefinitionItem,
	type TAbstractFile,
	type WorkspaceLeaf
} from "obsidian";
import {
	getPropertyKey,
	getCustomPropertyIconAnchor,
	getPropertyKeyEditableAnchor,
	getNativePropertyIconAnchor,
	getPropertyRows,
	isDomHTMLElement,
	isRowEditing,
	isRowEmpty,
	HIDDEN_CLASS,
	METADATA_CONTAINER_SELECTOR,
	CUSTOM_PROPERTY_ICON_CLASS,
	PROPERTY_KEY_SELECTOR,
	PROPERTY_ROW_SELECTOR,
	REORDER_BAR_CLASS,
	REORDER_DRAGGING_CLASS,
	REORDER_HANDLE_CLASS,
	REVEAL_AUTO_SEPARATOR_CLASS,
	REVEAL_GROUP_LABEL_CLASS,
	REVEALED_HIDDEN_CLASS,
	REVEAL_SEPARATOR_CLASS,
	TOGGLE_CLASS
} from "./dom-adapter";
import { toggleText } from "./empty-state";
import { GenerationToken } from "./lifecycle";
import {
	DEFAULT_SETTINGS,
	getContainingFolder,
	getManualHideSequence,
	getPropertyVisibility,
	migrateFolderRulePath,
	migrateNoteRulePath,
	migrateNoteRulesUnderFolderPath,
	normalizeSettings,
	PROPERTY_VISIBILITY_MODES,
	resolvePropertyVisibility,
	resetScopedRule,
	resetVaultRule,
	setScopedRule,
	setVaultRule,
	shouldHideProperty,
	type CompactEmptyPropertiesSettings,
	type PropertyVisibility,
	type PropertyVisibilityResolution,
	type ScopedPropertyVisibility,
	type ScopedRuleScope
} from "./property-visibility";
import {
	getPropertyIcon,
	mergePropertyIconNames,
	resetPropertyIcon as resetPropertyIconMap,
	setPropertyIcon as setPropertyIconMap
} from "./property-icons";
import {
	migrateFolderPropertyOrder,
	resolvePropertyOrder,
	resetFolderPropertyOrder,
	resetVaultPropertyOrder,
	setFolderPropertyOrder,
	setVaultPropertyOrder
} from "./property-order";

interface RowState {
	editing: boolean;
	empty: boolean;
	newlyCreated: boolean;
	creationGraceUntil: number;
}

interface ViewState {
	leaf: WorkspaceLeaf;
	view: MarkdownView;
	root: HTMLElement;
	noteKey: string;
	generation: GenerationToken;
	rootObserver?: MutationObserver;
	resolveFrame: number | undefined;
	retryCount: number;
	revealed: boolean;
	reorderSession: ReorderSession | undefined;
	contexts: Map<HTMLElement, MetadataContext>;
}

interface MetadataContext {
	state: ViewState;
	container: HTMLElement;
	generation: number;
	observer: MutationObserver;
	observerTimer: number | undefined;
	initialized: boolean;
	rows: Map<HTMLElement, RowState>;
	nativeRowOrder: HTMLElement[] | undefined;
	originalRowOrder: HTMLElement[] | undefined;
	separator: HTMLElement | undefined;
	manualLabel: HTMLElement | undefined;
	autoSeparator: HTMLElement | undefined;
	toggle: HTMLButtonElement | undefined;
	altGesture: AltGestureSnapshot | undefined;
	reorderBar: HTMLElement | undefined;
	drag: ReorderDragState | undefined;
	removeListeners: Array<() => void>;
	pendingBlurTimers: Set<number>;
}

interface AltGestureSnapshot {
	propertyName: string;
	file: TFile;
	row: HTMLElement;
	propertyKey: HTMLElement;
	notePath: string;
	folderPath: string;
	resolution: PropertyVisibilityResolution;
	empty: boolean;
	wouldHide: boolean;
	revealed: boolean;
	editing: boolean;
	startedAt: number;
	document: Document;
	x: number;
	y: number;
	width: number;
	menuOpened: boolean;
}

interface ReorderDragState {
	handle: HTMLButtonElement;
	row: HTMLElement;
	pointerId: number;
	startX: number;
	startY: number;
	startOrder: string[];
	active: boolean;
}

type PropertyOrderScope = "folders" | "vault";

interface ReorderSession {
	active: boolean;
	scope: PropertyOrderScope;
	entryOrder: string[];
	draftOrder: string[];
	dragActive: boolean;
}

interface RowRecord {
	row: HTMLElement;
	propertyKey: string | undefined;
	empty: boolean;
	hidden: boolean;
	revealedHidden: boolean;
	manualHidden: boolean;
	autoHidden: boolean;
	manualHideSequence: number;
	resolution: PropertyVisibilityResolution;
}

const NEW_PROPERTY_GRACE_MS = 800;

function reportError(message: string, error: unknown): void {
	console.error(`Compact Empty Properties: ${message}`, error);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default class CompactEmptyPropertiesPlugin extends Plugin {
	settings: CompactEmptyPropertiesSettings = DEFAULT_SETTINGS;
	controller!: PropertiesController;
	private settingTab?: CompactEmptyPropertiesSettingTab;

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.controller = new PropertiesController(this.app, this);

		this.settingTab = new CompactEmptyPropertiesSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.addCommand({
			id: "reorder-properties",
			name: "Reorder properties",
			checkCallback: (checking) => {
				const available = this.controller.canStartReorder();
				if (available && !checking) this.controller.openReorderScopeChooser();
				return available;
			}
		});
		this.registerEvent(this.app.workspace.on("layout-change", () => this.refreshAll()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshAll()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.refreshAll()));
		this.registerEvent(this.app.metadataCache.on("changed", () => this.refreshAll()));
		this.registerEvent(this.app.vault.on("create", () => this.settingTab?.refreshPropertyNames()));
		this.registerEvent(this.app.vault.on("delete", () => this.settingTab?.refreshPropertyNames()));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
			void this.handleRename(file, oldPath);
		}));
		this.app.workspace.onLayoutReady(() => this.controller.refreshAll());
	}

	async setHideEmptyProperties(value: boolean): Promise<void> {
		this.settings.hideEmptyProperties = value;
		await this.saveData(this.settings);
		this.controller.refreshAll();
	}

	async setPropertyVisibility(propertyName: string, visibility: PropertyVisibility): Promise<void> {
		this.settings = setVaultRule(this.settings, propertyName, visibility);
		this.controller.refreshAll();
		this.settingTab?.refreshPropertyNames();
		await this.saveData(this.settings);
	}

	async resetPropertyVisibility(propertyName: string): Promise<void> {
		this.settings = resetVaultRule(this.settings, propertyName);
		this.controller.refreshAll();
		this.settingTab?.refreshAll();
		await this.saveData(this.settings);
	}

	async setScopedPropertyVisibility(
		scope: ScopedRuleScope,
		scopePath: string,
		propertyName: string,
		visibility: ScopedPropertyVisibility
	): Promise<void> {
		this.settings = setScopedRule(this.settings, scope, scopePath, propertyName, visibility);
		this.controller.refreshAll();
		this.settingTab?.refreshAll();
		await this.saveData(this.settings);
	}

	async resetScopedPropertyVisibility(
		scope: ScopedRuleScope,
		scopePath: string,
		propertyName: string
	): Promise<void> {
		this.settings = resetScopedRule(this.settings, scope, scopePath, propertyName);
		this.controller.refreshAll();
		this.settingTab?.refreshAll();
		await this.saveData(this.settings);
	}

	async setPropertyIcon(propertyName: string, iconId: string): Promise<void> {
		this.settings = {
			...this.settings,
			propertyIcons: setPropertyIconMap(this.settings.propertyIcons, propertyName, iconId)
		};
		this.controller.refreshAll();
		this.settingTab?.refreshAll();
		await this.saveData(this.settings);
	}

	async resetPropertyIcon(propertyName: string): Promise<void> {
		this.settings = {
			...this.settings,
			propertyIcons: resetPropertyIconMap(this.settings.propertyIcons, propertyName)
		};
		this.controller.refreshAll();
		this.settingTab?.refreshAll();
		await this.saveData(this.settings);
	}

	async setVaultPropertyOrder(order: readonly string[]): Promise<void> {
		this.settings = setVaultPropertyOrder(this.settings, order);
		this.controller.refreshAll();
		this.settingTab?.refreshAll();
		await this.saveData(this.settings);
	}

	async setFolderPropertyOrder(folderPath: string, order: readonly string[]): Promise<void> {
		this.settings = setFolderPropertyOrder(this.settings, folderPath, order);
		this.controller.refreshAll();
		this.settingTab?.refreshAll();
		await this.saveData(this.settings);
	}

	async resetVaultPropertyOrder(): Promise<void> {
		this.settings = resetVaultPropertyOrder(this.settings);
		this.controller.refreshAll();
		this.settingTab?.refreshAll();
		await this.saveData(this.settings);
	}

	async resetFolderPropertyOrder(folderPath: string): Promise<void> {
		this.settings = resetFolderPropertyOrder(this.settings, folderPath);
		this.controller.refreshAll();
		this.settingTab?.refreshAll();
		await this.saveData(this.settings);
	}

	private async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
		let result = file instanceof TFolder
			? migrateFolderRulePath(this.settings, oldPath, file.path)
			: migrateNoteRulePath(this.settings, oldPath, file.path);
		if (file instanceof TFolder) {
			const noteResult = migrateNoteRulesUnderFolderPath(result.settings, oldPath, file.path);
			result = {
				settings: noteResult.settings,
				changed: result.changed || noteResult.changed
			};
			const orderResult = migrateFolderPropertyOrder(result.settings, oldPath, file.path);
			result = {
				settings: orderResult.settings,
				changed: result.changed || orderResult.changed
			};
		}
		if (!result.changed) {
			this.refreshAll();
			return;
		}

		this.settings = result.settings;
		this.controller.refreshAll();
		this.settingTab?.refreshAll();
		await this.saveData(this.settings);
	}

	private refreshAll(): void {
		this.controller.refreshAll();
		this.settingTab?.refreshAll();
	}

	onunload(): void {
		this.controller?.destroy();
	}
}

class PropertiesController {
	private readonly viewStates = new Map<WorkspaceLeaf, ViewState>();
	private readonly maxResolveRetries = 8;

	constructor(
		private readonly app: App,
		private readonly plugin: CompactEmptyPropertiesPlugin
	) {}

	canStartReorder(): boolean {
		return this.getActiveContext() !== undefined;
	}

	openReorderScopeChooser(anchor?: {
		document: Document;
		x: number;
		y: number;
		width?: number;
	}): void {
		const context = this.getActiveContext();
		if (!context) return;
		const hasFolder = getContainingFolder(context.state.noteKey).length > 0;
		const containerRect = context.container.getBoundingClientRect();
		const menuDocument = anchor?.document ?? context.container.ownerDocument;
		const menuPosition = anchor ?? {
			document: menuDocument,
			x: containerRect.left,
			y: containerRect.top,
			width: containerRect.width
		};
		const menu = new Menu().setNoIcon();
		menu.addItem((item) => item.setTitle("Reorder properties").setIsLabel(true));
		menu.addSeparator();
		if (hasFolder) {
			menu.addItem((item) => item
				.setTitle("This folder")
				.onClick(() => this.enterReorderMode(context, "folders")));
		}
		menu.addItem((item) => item
			.setTitle("This vault")
			.onClick(() => this.enterReorderMode(context, "vault")));
		menu.showAtPosition({
			x: menuPosition.x,
			y: menuPosition.y,
			width: menuPosition.width
		}, menuDocument);
	}

	private getActiveContext(): MetadataContext | undefined {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !this.isEditingView(view)) return undefined;
		const state = this.viewStates.get(view.leaf);
		if (!state) return undefined;
		return Array.from(state.contexts.values())
			.find((context) => this.isCurrentContext(context) && context.container.isConnected);
	}

	private enterReorderMode(context: MetadataContext, scope: PropertyOrderScope): void {
		if (!this.isCurrentContext(context)) return;
		if (scope === "folders" && !getContainingFolder(context.state.noteKey)) return;
		if (context.state.reorderSession?.active) this.cancelReorderMode(context);
		const entryOrder = this.getCurrentPropertyNames(context);
		const session: ReorderSession = {
			active: true,
			scope,
			entryOrder: [...entryOrder],
			draftOrder: [...entryOrder],
			dragActive: false
		};
		context.state.reorderSession = session;
		this.evaluateContext(context, context.generation);
	}

	private cancelReorderMode(context: MetadataContext): void {
		const session = context.state.reorderSession;
		if (!session?.active) return;
		if (context.drag) {
			if (context.drag.handle.hasPointerCapture(context.drag.pointerId)) {
				context.drag.handle.releasePointerCapture(context.drag.pointerId);
			}
			context.drag.handle.classList.remove(REORDER_DRAGGING_CLASS);
		}
		context.drag = undefined;
		session.active = false;
		session.dragActive = false;
		context.state.reorderSession = undefined;
		context.reorderBar?.remove();
		context.reorderBar = undefined;
		for (const row of getPropertyRows(context.container)) {
			row.querySelector(`.${REORDER_HANDLE_CLASS}`)?.remove();
		}
		this.evaluateContext(context, context.generation);
	}

	refreshAll(): void {
		const seenLeaves = new Set<WorkspaceLeaf>();
		try {
			this.app.workspace.iterateAllLeaves((leaf) => {
				try {
					const view = leaf.view;
					// Keep the leaf represented while Obsidian temporarily swaps a
					// MarkdownView for a deferred/rebuilding view.
					seenLeaves.add(leaf);
					if (!(view instanceof MarkdownView)) return;
					if (!view.file) return;
					if (!this.isEditingView(view)) {
						this.destroyViewState(leaf);
						return;
					}

					const state = this.ensureViewState(view);
					this.syncViewIdentity(state);
					this.resolveView(state, state.generation.current());
				} catch (error) {
					reportError("refresh error", error);
				}
			});
		} catch (error) {
			reportError("workspace refresh error", error);
		}

		for (const leaf of Array.from(this.viewStates.keys())) {
			if (!seenLeaves.has(leaf)) this.destroyViewState(leaf);
		}
	}

	destroy(): void {
		for (const leaf of Array.from(this.viewStates.keys())) this.destroyViewState(leaf);
	}

	private ensureViewState(view: MarkdownView): ViewState {
		const leaf = view.leaf;
		const existing = this.viewStates.get(leaf);
		if (existing) {
			const previousRoot = existing.root;
			existing.view = view;
			if (previousRoot === view.containerEl) return existing;

			existing.rootObserver?.disconnect();
			this.cancelResolve(existing);
			for (const context of Array.from(existing.contexts.values())) this.destroyContext(context);
			existing.root = view.containerEl;
			existing.generation.invalidate();
			existing.retryCount = 0;
			const rootObserver = this.createRootObserver(existing);
			existing.rootObserver = rootObserver;
			rootObserver.observe(existing.root, { childList: true, subtree: true });
			return existing;
		}

		let state: ViewState;
		state = {
			leaf,
			view,
			root: view.containerEl,
			noteKey: this.getNoteKey(view),
			generation: new GenerationToken(),
			rootObserver: undefined,
			resolveFrame: undefined,
			retryCount: 0,
			revealed: false,
			reorderSession: undefined,
			contexts: new Map()
		};
		const rootObserver = this.createRootObserver(state);
		state.rootObserver = rootObserver;
		this.viewStates.set(leaf, state);
		rootObserver.observe(state.root, { childList: true, subtree: true });
		return state;
	}

	private createRootObserver(state: ViewState): MutationObserver {
		return new MutationObserver(() => {
			try {
				if (this.viewStates.get(state.leaf) !== state) return;
				if (this.findMetadataContainers(state.root).length > 0) state.retryCount = 0;
				this.scheduleResolve(state, state.generation.current());
			} catch (error) {
				reportError("root observer error", error);
			}
		});
	}

	private syncViewIdentity(state: ViewState): number {
		const noteKey = this.getNoteKey(state.view);
		// Obsidian can transiently expose view.file as null while rebuilding a
		// Markdown view. That is not a Note switch and must not close Reveal.
		if (!noteKey || state.noteKey === noteKey) return state.generation.current();

		state.noteKey = noteKey;
		this.setRevealState(state, false);
		state.reorderSession = undefined;
		const generation = state.generation.invalidate();
		this.cancelResolve(state);
		state.retryCount = 0;
		for (const context of Array.from(state.contexts.values())) this.destroyContext(context);
		return generation;
	}

	private resolveView(state: ViewState, generation: number): void {
		if (!this.isCurrentGeneration(state, generation)) return;

		const currentNoteKey = this.getNoteKey(state.view);
			if (currentNoteKey && currentNoteKey !== state.noteKey) {
			const nextGeneration = this.syncViewIdentity(state);
			this.resolveView(state, nextGeneration);
			return;
		}
		const containers = this.findMetadataContainers(state.root);
		const currentContainers = new Set(containers);
		for (const [container, context] of Array.from(state.contexts.entries())) {
			if (!currentContainers.has(container) || !container.isConnected) {
				this.destroyContext(context);
			}
		}

		if (containers.length === 0) {
			if (state.retryCount < this.maxResolveRetries) {
				state.retryCount += 1;
				this.scheduleResolve(state, generation);
			}
			return;
		}

		state.retryCount = 0;
		for (const container of containers) this.ensureContext(state, container, generation);
	}

	private findMetadataContainers(root: HTMLElement): HTMLElement[] {
		const containers: HTMLElement[] = [];
		if (root.matches(METADATA_CONTAINER_SELECTOR)) containers.push(root);
		containers.push(...Array.from(root.querySelectorAll<HTMLElement>(METADATA_CONTAINER_SELECTOR)));
		return containers;
	}

	private ensureContext(state: ViewState, container: HTMLElement, generation: number): void {
		const existing = state.contexts.get(container);
		if (existing && existing.generation === generation) {
			this.evaluateContext(existing, generation);
			return;
		}
		if (existing) this.destroyContext(existing);

		let context: MetadataContext;
		const observer = new MutationObserver(() => {
			try {
				if (!this.isCurrentContext(context)) return;
				this.scheduleApply(context, generation);
			} catch (error) {
				reportError("observer callback error", error);
			}
		});
		context = {
			state,
			container,
			generation,
			observer,
			observerTimer: undefined,
			initialized: false,
			rows: new Map(),
			nativeRowOrder: getPropertyRows(container),
			originalRowOrder: undefined,
			separator: undefined,
			manualLabel: undefined,
			autoSeparator: undefined,
			toggle: undefined,
			altGesture: undefined,
			reorderBar: undefined,
			drag: undefined,
			removeListeners: [],
			pendingBlurTimers: new Set()
		};
		state.contexts.set(container, context);

		const onFocusIn = (event: FocusEvent): void => {
			const row = this.findRow(event.target);
			if (!row || !this.isCurrentContext(context)) return;
			const knownRow = context.rows.has(row);
			const rowState = context.rows.get(row) ?? {
				editing: false,
				empty: false,
				newlyCreated: context.initialized,
				creationGraceUntil: context.initialized ? Date.now() + NEW_PROPERTY_GRACE_MS : 0
			};
			rowState.editing = true;
			if (!knownRow && context.initialized) {
				rowState.newlyCreated = true;
				rowState.creationGraceUntil = Date.now() + NEW_PROPERTY_GRACE_MS;
			}
			row.dataset.cepEditing = "true";
			context.rows.set(row, rowState);
			if (this.getRowVisibility(context, row) !== "hide") row.classList.remove(HIDDEN_CLASS);
			this.scheduleApply(context, generation);
		};
		const onFocusOut = (event: FocusEvent): void => {
			const row = this.findRow(event.target);
			if (!row || !this.isCurrentContext(context)) return;
			const blurTimer = window.setTimeout(() => {
				context.pendingBlurTimers.delete(blurTimer);
				if (!this.isCurrentContext(context) || row.contains(row.ownerDocument.activeElement)) return;
				if (!row.isConnected || !context.container.contains(row)) {
					context.rows.delete(row);
					return;
				}
				const rowState = context.rows.get(row);
				if (!rowState) return;
				rowState.editing = false;
				rowState.newlyCreated = false;
				delete row.dataset.cepEditing;
				this.evaluateContext(context, generation);
			}, 0);
			context.pendingBlurTimers.add(blurTimer);
		};
		const onAltPointerDown = (event: PointerEvent): void => {
			try {
				if (!event.altKey) return;
				const row = this.findRow(event.target);
				const propertyKey = this.findPropertyKey(event.target);
				if (!row || !propertyKey || !this.isCurrentContext(context)) return;
				const propertyName = getPropertyKey(row);
				if (!propertyName) return;
				const snapshot = this.createAltGestureSnapshot(context, row, propertyKey, event);
				context.altGesture = snapshot;
				event.preventDefault();
				event.stopPropagation();
				this.openVisibilityMenu(context, snapshot);
			} catch (error) {
				reportError("alt pointerdown error", error);
			}
		};
		const onAltMouseDown = (event: MouseEvent): void => {
			try {
				if (!event.altKey) return;
				const row = this.findRow(event.target);
				const propertyKey = this.findPropertyKey(event.target);
				if (!row || !propertyKey || !this.isCurrentContext(context)) return;
				const snapshot = context.altGesture && this.isAltGestureUsable(context.altGesture)
					? context.altGesture
					: this.createAltGestureSnapshot(context, row, propertyKey, event);
				event.preventDefault();
				event.stopPropagation();
				if (!snapshot.menuOpened) this.openVisibilityMenu(context, snapshot);
			} catch (error) {
				reportError("alt mousedown error", error);
			}
		};
		const onRowClick = (event: MouseEvent): void => {
			try {
				const row = this.findRow(event.target);
				if (!row || !this.isCurrentContext(context)) return;
				if (!event.altKey) {
					this.scheduleApply(context, generation);
					return;
				}
				const propertyKey = this.findPropertyKey(event.target);
				if (!propertyKey) return;
				const snapshot = context.altGesture && this.isAltGestureUsable(context.altGesture)
					? context.altGesture
					: this.createAltGestureSnapshot(context, row, propertyKey, event);
				event.preventDefault();
				event.stopPropagation();
				if (!snapshot.menuOpened) this.openVisibilityMenu(context, snapshot);
				context.altGesture = undefined;
				this.scheduleApply(context, generation);
			} catch (error) {
				reportError("alt-click handler error", error);
			}
		};
		const onValueChange = (): void => {
			if (this.isCurrentContext(context)) this.scheduleApply(context, generation);
		};

		container.addEventListener("focusin", onFocusIn);
		container.addEventListener("focusout", onFocusOut);
		container.addEventListener("pointerdown", onAltPointerDown, true);
		container.addEventListener("mousedown", onAltMouseDown, true);
		container.addEventListener("click", onRowClick, true);
		container.addEventListener("input", onValueChange);
		container.addEventListener("change", onValueChange);
		container.addEventListener("blur", onValueChange, true);
		context.removeListeners.push(
			() => container.removeEventListener("focusin", onFocusIn),
			() => container.removeEventListener("focusout", onFocusOut),
			() => container.removeEventListener("pointerdown", onAltPointerDown, true),
			() => container.removeEventListener("mousedown", onAltMouseDown, true),
			() => container.removeEventListener("click", onRowClick, true),
			() => container.removeEventListener("input", onValueChange),
			() => container.removeEventListener("change", onValueChange),
			() => container.removeEventListener("blur", onValueChange, true)
		);

		observer.observe(container, {
			childList: true,
			subtree: true,
			characterData: true
		});
		// First evaluation is synchronous once the container is mounted.
		this.evaluateContext(context, generation);
	}

	private evaluateContext(context: MetadataContext, generation: number): void {
		if (!this.isCurrentContext(context) || generation !== context.generation) return;
		if (!context.container.isConnected) {
			this.scheduleResolve(context.state, generation);
			return;
		}
		try {
			this.apply(context);
		} catch (error) {
			reportError("apply error", error);
		}
	}

	private apply(context: MetadataContext): void {
		if (!this.isCurrentContext(context)) return;
		if (!context.container.isConnected) {
			this.destroyContext(context);
			return;
		}
		const currentRows = getPropertyRows(context.container);
		const reorderSession = context.state.reorderSession;
		const currentSet = new Set(currentRows);
		this.discardStaleRows(context, currentSet);

		const rowRecords: RowRecord[] = [];
		const now = Date.now();
		let nextCreationGraceDelay = 0;
		for (const row of currentRows) {
			const rowState = context.rows.get(row) ?? {
				editing: isRowEditing(row),
				empty: false,
				// A replaced DOM row is not necessarily a newly-created
				// Property. Only protect it while it is actively being edited.
				newlyCreated: context.initialized && isRowEditing(row),
				creationGraceUntil: context.initialized ? Date.now() + NEW_PROPERTY_GRACE_MS : 0
			};
			const editing = rowState.editing || isRowEditing(row);
			rowState.editing = editing;
			if (rowState.creationGraceUntil > now) {
				nextCreationGraceDelay = Math.max(nextCreationGraceDelay, rowState.creationGraceUntil - now);
			} else if (rowState.newlyCreated && !editing) {
				rowState.newlyCreated = false;
			}
			const creationProtected = rowState.newlyCreated || rowState.creationGraceUntil > now;
			const key = getPropertyKey(row);
			const cached = key
				? this.getCachedValue(context.state.view.file, key)
				: { found: false, value: undefined };
			const empty = isRowEmpty(row, cached.value, cached.found);
			rowState.empty = empty;
			context.rows.set(row, rowState);

			const resolution = resolvePropertyVisibility(this.plugin.settings, context.state.noteKey, key);
			const hiddenWithoutReveal = shouldHideProperty({
				visibility: resolution.visibility,
				compactEnabled: this.plugin.settings.hideEmptyProperties,
				expanded: false,
				revealActive: false,
				empty,
				editing,
				newlyCreated: creationProtected
			});
			const hidden = reorderSession?.active
				? false
				: shouldHideProperty({
					visibility: resolution.visibility,
					compactEnabled: this.plugin.settings.hideEmptyProperties,
					expanded: context.state.revealed,
					revealActive: context.state.revealed,
					empty,
					editing,
					newlyCreated: creationProtected
				});
			const manualHidden = hiddenWithoutReveal && resolution.visibility === "hide";
			const autoHidden = hiddenWithoutReveal && resolution.visibility === "auto";
			row.classList.toggle(HIDDEN_CLASS, hidden);
			row.classList.toggle(REVEALED_HIDDEN_CLASS, context.state.revealed && hiddenWithoutReveal);
			if (!hidden) row.removeAttribute("data-compact-empty-properties-hidden");
			else row.setAttribute("data-compact-empty-properties-hidden", "true");
			this.syncCustomPropertyIcon(row, key);
			this.syncReorderHandle(context, row);
			rowRecords.push({
				row,
				propertyKey: key,
				empty,
				hidden,
				revealedHidden: context.state.revealed && hiddenWithoutReveal,
				manualHidden,
				autoHidden,
				manualHideSequence: manualHidden
					? getManualHideSequence(this.plugin.settings, context.state.noteKey, key, resolution)
					: 0,
				resolution
			});
		}
		context.initialized = true;
		if (reorderSession?.active) {
		// During reorder mode, the live Property row DOM is the draft source of
		// truth. Refresh row state and controls without changing row order until
		// Done exits the session.
			this.syncToggle(context, rowRecords);
			this.syncReorderBar(context);
			return;
		}

		const nativeInteractionActive = this.hasNativePropertyInteraction(context, rowRecords, now);
		const orderedRecords = reorderSession?.dragActive
			? rowRecords
			: nativeInteractionActive
			? rowRecords
			: reorderSession?.active
				? this.applyReorderDraftOrder(context, rowRecords)
			: context.state.revealed
					? this.reorderRevealedRows(context, rowRecords)
					: this.restoreOriginalRowOrder(context, rowRecords);
		if (reorderSession?.dragActive) {
			// A live row move is the source of truth during the gesture. The
			// observer may see each insertBefore, but must not regroup rows until
			// pointerup has captured the final live DOM order.
		} else if (!nativeInteractionActive) {
			this.syncRevealSeparators(context, orderedRecords);
			this.syncToggle(context, rowRecords);
			this.syncReorderBar(context);
		}
		if (nextCreationGraceDelay > 0) this.scheduleApply(context, context.generation, nextCreationGraceDelay);
	}

	private discardStaleRows(
		context: MetadataContext,
		currentSet: Set<HTMLElement>
	): void {
		if (context.nativeRowOrder) {
			context.nativeRowOrder = context.nativeRowOrder.filter((row) => currentSet.has(row) && row.isConnected);
		}
		if (context.originalRowOrder) {
			context.originalRowOrder = context.originalRowOrder.filter((row) => currentSet.has(row) && row.isConnected);
		}
		for (const row of Array.from(context.rows.keys())) {
			if (!currentSet.has(row) || !row.isConnected) context.rows.delete(row);
		}
	}

	private hasNativePropertyInteraction(
		context: MetadataContext,
		rowRecords: RowRecord[],
		now: number
	): boolean {
		return rowRecords.some((record) => {
			const rowState = context.rows.get(record.row);
			return isRowEditing(record.row) ||
				rowState?.editing === true ||
				rowState?.newlyCreated === true ||
				(rowState?.creationGraceUntil ?? 0) > now;
		});
	}

	private syncCustomPropertyIcon(row: HTMLElement, propertyName: string | undefined): void {
		const existing = row.querySelector<HTMLElement>(`.${CUSTOM_PROPERTY_ICON_CLASS}`);
		const iconId = getPropertyIcon(this.plugin.settings.propertyIcons, propertyName);
		if (!iconId || getIcon(iconId) === null) {
			existing?.remove();
			return;
		}

		const customIcon = existing ?? this.createCustomPropertyIcon(row);
		if (!customIcon) return;
		const propertyKey = row.querySelector<HTMLElement>(PROPERTY_KEY_SELECTOR);
		if (propertyKey) {
			const anchor = getCustomPropertyIconAnchor(propertyKey);
			if (anchor && (customIcon.parentElement !== propertyKey || customIcon.nextElementSibling !== anchor)) {
				propertyKey.insertBefore(customIcon, anchor);
			} else if (!anchor) {
				if (getNativePropertyIconAnchor(propertyKey)) propertyKey.appendChild(customIcon);
				else if (customIcon.parentElement !== propertyKey) propertyKey.insertBefore(customIcon, propertyKey.firstChild);
			}
		}
		if (customIcon.dataset.iconId === iconId && customIcon.querySelector("svg")) return;

		while (customIcon.firstChild) customIcon.removeChild(customIcon.firstChild);
		setIcon(customIcon, iconId);
		customIcon.dataset.iconId = iconId;
	}

	private createCustomPropertyIcon(row: HTMLElement): HTMLElement | undefined {
		const propertyKey = row.querySelector<HTMLElement>(PROPERTY_KEY_SELECTOR);
		if (!propertyKey) return undefined;

		const customIcon = propertyKey.createEl("span");
		customIcon.className = CUSTOM_PROPERTY_ICON_CLASS;
		customIcon.setAttribute("aria-hidden", "true");
		customIcon.setAttribute("data-cep-custom-icon", "true");

		const anchor = getCustomPropertyIconAnchor(propertyKey);
		if (anchor) propertyKey.insertBefore(customIcon, anchor);
		else if (getNativePropertyIconAnchor(propertyKey)) propertyKey.appendChild(customIcon);
		else propertyKey.insertBefore(customIcon, propertyKey.firstChild);
		return customIcon;
	}

	private getNativeRows(
		context: MetadataContext,
		rowRecords: RowRecord[]
	): HTMLElement[] {
		const currentRows = rowRecords.map((record) => record.row);
		const currentSet = new Set(currentRows);
		const baseline = context.nativeRowOrder ?? currentRows;
		const ordered = baseline.filter((row) => row.isConnected && currentSet.has(row));
		const known = new Set(ordered);
		for (const row of currentRows) {
			if (!known.has(row)) {
				ordered.push(row);
				known.add(row);
			}
		}
		return ordered;
	}

	private getEffectiveRowRecords(
		context: MetadataContext,
		rowRecords: RowRecord[]
	): RowRecord[] {
		const nativeRows = this.getNativeRows(context, rowRecords);
		const recordByRow = new Map(rowRecords.map((record) => [record.row, record]));
		const nativeRecords = nativeRows
			.map((row) => recordByRow.get(row))
			.filter((record): record is RowRecord => record !== undefined);
		const nativeNames = nativeRecords
			.map((record) => record.propertyKey)
			.filter((propertyName): propertyName is string => propertyName !== undefined);
		const reorderSession = context.state.reorderSession;
		const resolvedNames = reorderSession?.active
			? reorderSession.draftOrder
			: resolvePropertyOrder(
					this.plugin.settings,
					context.state.noteKey,
					nativeNames
			);
		const recordByName = new Map<string, RowRecord>();
		for (const record of nativeRecords) {
			if (record.propertyKey && !recordByName.has(record.propertyKey)) {
				recordByName.set(record.propertyKey, record);
			}
		}

		const ordered: RowRecord[] = [];
		const seenRows = new Set<HTMLElement>();
		for (const propertyName of resolvedNames) {
			const record = recordByName.get(propertyName);
			if (record && !seenRows.has(record.row)) {
				ordered.push(record);
				seenRows.add(record.row);
			}
		}
		for (const record of nativeRecords) {
			if (!seenRows.has(record.row)) {
				ordered.push(record);
				seenRows.add(record.row);
			}
		}
		return ordered;
	}

	private getCurrentPropertyNames(context: MetadataContext): string[] {
		const names: string[] = [];
		const seen = new Set<string>();
		for (const row of getPropertyRows(context.container)) {
			const propertyName = getPropertyKey(row);
			if (!propertyName || seen.has(propertyName)) continue;
			seen.add(propertyName);
			names.push(propertyName);
		}
		return names;
	}

	private applyReorderDraftOrder(
		context: MetadataContext,
		rowRecords: RowRecord[]
	): RowRecord[] {
		const effectiveRecords = this.getEffectiveRowRecords(context, rowRecords);
		const draftOrder = context.state.reorderSession?.draftOrder;
		if (!draftOrder || draftOrder.length === 0) return effectiveRecords;

		const recordByName = new Map<string, RowRecord>();
		for (const record of effectiveRecords) {
			if (record.propertyKey && !recordByName.has(record.propertyKey)) {
				recordByName.set(record.propertyKey, record);
			}
		}
		const ordered: RowRecord[] = [];
		const seenRows = new Set<HTMLElement>();
		for (const propertyName of draftOrder) {
			const record = recordByName.get(propertyName);
			if (record && !seenRows.has(record.row)) {
				ordered.push(record);
				seenRows.add(record.row);
			}
		}
		for (const record of effectiveRecords) {
			if (!seenRows.has(record.row)) {
				ordered.push(record);
				seenRows.add(record.row);
			}
		}
		this.reorderRowsInParent(ordered.map((record) => record.row));
		return ordered;
	}

	private syncReorderHandle(context: MetadataContext, row: HTMLElement): void {
		const existing = row.querySelector<HTMLButtonElement>(`.${REORDER_HANDLE_CLASS}`);
		if (!context.state.reorderSession?.active) {
			existing?.remove();
			return;
		}

		const propertyKey = row.querySelector<HTMLElement>(PROPERTY_KEY_SELECTOR);
		if (!propertyKey) return;
		const handle = existing ?? this.createReorderHandle(context, row, propertyKey);
		if (!handle) return;

		const nativeIcon = getNativePropertyIconAnchor(propertyKey);
		const customIcon = propertyKey.querySelector<HTMLElement>(`.${CUSTOM_PROPERTY_ICON_CLASS}`);
		const anchor = nativeIcon ?? (customIcon?.parentElement === propertyKey
			? customIcon
			: getPropertyKeyEditableAnchor(propertyKey));
		if (anchor && (handle.parentElement !== propertyKey || handle.nextElementSibling !== anchor)) {
			propertyKey.insertBefore(handle, anchor);
		} else if (!anchor && handle.parentElement !== propertyKey) {
			propertyKey.insertBefore(handle, propertyKey.firstChild);
		}
	}

	private createReorderHandle(
		context: MetadataContext,
		row: HTMLElement,
		propertyKey: HTMLElement
	): HTMLButtonElement {
		const handle = propertyKey.createEl("button");
		handle.type = "button";
		handle.className = REORDER_HANDLE_CLASS;
		handle.setAttribute("aria-label", "Reorder property");
		handle.setAttribute("title", "Drag to reorder. Use Arrow Up or Arrow Down to move.");
		handle.setAttribute("draggable", "false");
		setIcon(handle, "grip-vertical");
		handle.addEventListener("pointerdown", (event) => {
			this.beginReorderDrag(context, row, handle, event);
		});
		handle.addEventListener("pointermove", (event) => {
			this.updateReorderDrag(context, event);
		});
		handle.addEventListener("pointerup", (event) => {
			this.finishReorderDrag(context, event, false);
		});
		handle.addEventListener("pointercancel", (event) => {
			this.finishReorderDrag(context, event, true);
		});
		handle.addEventListener("keydown", (event) => {
			if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
			event.preventDefault();
			event.stopPropagation();
			const delta = event.key === "ArrowUp" ? -1 : 1;
			this.moveRowBy(context, row, delta);
		});
		return handle;
	}

	private beginReorderDrag(
		context: MetadataContext,
		row: HTMLElement,
		handle: HTMLButtonElement,
		event: PointerEvent
	): void {
		const session = context.state.reorderSession;
		if (!session?.active || event.button !== 0 || !row.isConnected) return;
		event.preventDefault();
		event.stopPropagation();
		session.dragActive = true;
		context.drag = {
			handle,
			row,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			startOrder: this.getCurrentPropertyNames(context),
			active: false
		};
		try {
			handle.setPointerCapture(event.pointerId);
		} catch {
			// Pointer capture is not available in a few embedded/mobile contexts;
			// the handle's pointer events still provide the fallback path.
		}
	}

	private updateReorderDrag(context: MetadataContext, event: PointerEvent): void {
		const drag = context.drag;
		if (!drag || drag.pointerId !== event.pointerId || !context.state.reorderSession?.active) return;
		const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
		if (!drag.active) {
			if (distance < 5) return;
			drag.active = true;
			drag.handle.classList.add(REORDER_DRAGGING_CLASS);
		}
		event.preventDefault();
		const target = this.findRowAtPoint(context, event.clientX, event.clientY);
		if (!target || target === drag.row) return;
		this.previewRowMove(context, drag.row, target, event.clientY);
	}

	private finishReorderDrag(
		context: MetadataContext,
		event: PointerEvent,
		cancelled: boolean
	): void {
		const drag = context.drag;
		if (!drag || drag.pointerId !== event.pointerId) return;
		const finalOrder = this.getCurrentPropertyNames(context);
		if (cancelled && drag.active) {
			this.updateDraftOrder(context, drag.startOrder);
		} else if (drag.active) {
			this.updateDraftOrder(context, finalOrder);
		}
		if (drag.handle.hasPointerCapture(event.pointerId)) {
			drag.handle.releasePointerCapture(event.pointerId);
		}
		drag.handle.classList.remove(REORDER_DRAGGING_CLASS);
		context.drag = undefined;
		const session = context.state.reorderSession;
		if (session) session.dragActive = false;
		if (cancelled && drag.active) {
			this.evaluateContext(context, context.generation);
			return;
		}
		if (drag.active) {
			this.scheduleApply(context, context.generation);
		} else {
			this.evaluateContext(context, context.generation);
		}
	}

	private findRowAtPoint(
		context: MetadataContext,
		x: number,
		y: number
	): HTMLElement | undefined {
		const target = context.container.ownerDocument.elementFromPoint(x, y);
		if (!target || typeof target.closest !== "function" || !context.container.contains(target)) return undefined;
		const row = target.closest<HTMLElement>(PROPERTY_ROW_SELECTOR);
		return row && context.container.contains(row) ? row : undefined;
	}

	private previewRowMove(
		context: MetadataContext,
		dragged: HTMLElement,
		target: HTMLElement,
		pointerY: number
	): void {
		const parent = dragged.parentElement;
		if (!parent || target.parentElement !== parent) return;
		const targetRect = target.getBoundingClientRect();
		const insertBefore = pointerY < targetRect.top + targetRect.height / 2;
		if (insertBefore && dragged.nextElementSibling === target) return;
		if (!insertBefore && target.nextElementSibling === dragged) return;
		if (insertBefore) parent.insertBefore(dragged, target);
		else parent.insertBefore(dragged, target.nextSibling);
		this.updateDraftOrder(context, this.getCurrentPropertyNames(context));
	}

	private updateDraftOrder(context: MetadataContext, order: readonly string[]): void {
		const session = context.state.reorderSession;
		if (!session?.active) return;
		session.draftOrder = [...order];
	}

	private moveRowBy(context: MetadataContext, row: HTMLElement, delta: -1 | 1): boolean {
		if (!context.state.reorderSession?.active || !row.isConnected) return false;
		const rows = getPropertyRows(context.container).filter((candidate) => candidate.parentElement === row.parentElement);
		const index = rows.indexOf(row);
		const target = rows[index + delta];
		if (!target || !row.parentElement) return false;
		if (delta < 0) row.parentElement.insertBefore(row, target);
		else row.parentElement.insertBefore(row, target.nextSibling);
		this.updateDraftOrder(context, this.getCurrentPropertyNames(context));
		return true;
	}

	private async commitReorderMode(context: MetadataContext): Promise<void> {
		const session = context.state.reorderSession;
		if (!session?.active) return;
		const draftOrder = [...session.draftOrder];
		try {
			await this.persistDraftOrder(context, session, draftOrder);
		} catch (error) {
			reportError("order save error", error);
			return;
		}
		if (context.state.reorderSession !== session) return;
		session.active = false;
		session.dragActive = false;
		context.state.reorderSession = undefined;
		context.reorderBar?.remove();
		context.reorderBar = undefined;
		for (const row of getPropertyRows(context.container)) {
			row.querySelector(`.${REORDER_HANDLE_CLASS}`)?.remove();
		}
		this.evaluateContext(context, context.generation);
	}

	private async persistDraftOrder(
		context: MetadataContext,
		session: ReorderSession,
		order: readonly string[]
	): Promise<void> {
		if (!session.active) return;
		if (session.scope === "vault") {
			await this.plugin.setVaultPropertyOrder(order);
			return;
		}
		const folderPath = getContainingFolder(context.state.noteKey);
		if (folderPath) {
			await this.plugin.setFolderPropertyOrder(folderPath, order);
		}
	}

	private reorderRevealedRows(
		context: MetadataContext,
		rowRecords: RowRecord[]
	): RowRecord[] {
		const orderedRecords = this.getEffectiveRowRecords(context, rowRecords);
		const visibleRecords = orderedRecords.filter((record) => !record.revealedHidden);
		const nativeRows = this.getNativeRows(context, rowRecords);
		const nativeIndex = new Map(nativeRows.map((row, index) => [row, index]));
		const manualRecords = orderedRecords
			.filter((record) => record.manualHidden)
			.sort((left, right) =>
				right.manualHideSequence - left.manualHideSequence ||
				(nativeIndex.get(left.row) ?? 0) - (nativeIndex.get(right.row) ?? 0)
			);
		const autoRecords = nativeRows
			.map((row) => orderedRecords.find((record) => record.row === row))
			.filter((record): record is RowRecord => record?.autoHidden === true);
		const desiredRecords = visibleRecords.concat(manualRecords, autoRecords);
		this.reorderRowsInParent(desiredRecords.map((record) => record.row));
		return desiredRecords;
	}

	private restoreOriginalRowOrder(
		context: MetadataContext,
		rowRecords: RowRecord[]
	): RowRecord[] {
		const orderedRecords = this.getEffectiveRowRecords(context, rowRecords);
		this.reorderRowsInParent(orderedRecords.map((record) => record.row));
		this.removeRevealMarkers(context);
		return orderedRecords;
	}

	private reorderRowsInParent(rows: HTMLElement[]): void {
		if (rows.length < 2) return;
		if (rows.some((row) => !row.isConnected)) return;
		const parent = rows[0].parentElement;
		if (!parent || rows.some((row) => row.parentElement !== parent)) return;

		const rowSet = new Set(rows);
		const currentRows = Array.from(parent.children)
			.filter((child): child is HTMLElement => isDomHTMLElement(child) && rowSet.has(child));
		if (currentRows.length !== rows.length || currentRows.every((row, index) => row === rows[index])) return;

		const anchor = Array.from(parent.children).find((child) =>
			(!isDomHTMLElement(child) || !rowSet.has(child)) && !this.isRevealMarker(child)
		) ?? parent.querySelector<HTMLElement>(`.${REVEAL_SEPARATOR_CLASS}`);
		for (const row of rows) {
			if (anchor) parent.insertBefore(row, anchor);
			else parent.appendChild(row);
		}
	}

	private isRevealMarker(element: Element): boolean {
		return element.classList.contains(REVEAL_SEPARATOR_CLASS) ||
			element.classList.contains(REVEAL_GROUP_LABEL_CLASS);
	}

	private syncRevealSeparators(context: MetadataContext, rowRecords: RowRecord[]): void {
		const manualRow = context.state.revealed
			? rowRecords.find((record) => record.manualHidden)?.row
			: undefined;
		const autoRow = context.state.revealed
			? rowRecords.find((record) => record.autoHidden)?.row
			: undefined;
		const firstHiddenRow = manualRow ?? autoRow;
		if (!firstHiddenRow) {
			this.removeRevealMarkers(context);
			return;
		}

		this.ensureRevealMarker(context, "separator", firstHiddenRow, REVEAL_SEPARATOR_CLASS, "Hidden properties");
		if (manualRow) {
			this.ensureRevealMarker(context, "manualLabel", manualRow, REVEAL_GROUP_LABEL_CLASS, "Manual hidden", false);
		} else {
			this.removeRevealMarker(context, "manualLabel");
		}
		if (autoRow) {
			this.ensureRevealMarker(
				context,
				"autoSeparator",
				autoRow,
				`${REVEAL_GROUP_LABEL_CLASS} ${REVEAL_AUTO_SEPARATOR_CLASS}`,
				"Auto hidden"
			);
		} else {
			this.removeRevealMarker(context, "autoSeparator");
		}
	}

	private ensureRevealMarker(
		context: MetadataContext,
		kind: "separator" | "manualLabel" | "autoSeparator",
		row: HTMLElement,
		className: string,
		labelText: string,
		withRole = kind !== "manualLabel"
	): void {
		let marker = context[kind];
		if (!marker || !marker.isConnected) {
			marker = context.container.createDiv();
			marker.className = className;
			if (withRole) marker.setAttribute("role", "separator");
			marker.setAttribute("aria-label", labelText);
			marker.textContent = labelText;
			context[kind] = marker;
		}
		const parent = row.parentElement;
		if (parent && (marker.parentElement !== parent || marker.nextElementSibling !== row)) {
			parent.insertBefore(marker, row);
		}
	}

	private removeRevealMarker(
		context: MetadataContext,
		kind: "separator" | "manualLabel" | "autoSeparator"
	): void {
		context[kind]?.remove();
		context[kind] = undefined;
	}

	private removeRevealMarkers(context: MetadataContext): void {
		this.removeRevealMarker(context, "separator");
		this.removeRevealMarker(context, "manualLabel");
		this.removeRevealMarker(context, "autoSeparator");
	}

	private syncToggle(
		context: MetadataContext,
		rowRecords: RowRecord[]
	): void {
		if (context.state.reorderSession?.active) {
			context.toggle?.remove();
			context.toggle = undefined;
			return;
		}
		const hiddenCount = rowRecords.filter((record) => record.hidden).length;
		if (!context.state.revealed && hiddenCount === 0) {
			context.toggle?.remove();
			context.toggle = undefined;
			return;
		}

		const label = toggleText(context.state.revealed, hiddenCount);
			let toggle = context.toggle;
			if (!toggle || !toggle.isConnected) {
				toggle = context.container.createEl("button");
				toggle.type = "button";
				toggle.className = TOGGLE_CLASS;
				toggle.setAttribute("aria-live", "polite");
				toggle.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					const nextRevealed = !context.state.revealed;
					if (nextRevealed) context.originalRowOrder = getPropertyRows(context.container);
					this.setRevealState(context.state, nextRevealed);
					this.evaluateContext(context, context.generation);
					if (!nextRevealed) context.originalRowOrder = undefined;
				});
			context.toggle = toggle;
			const nativeAddButton = Array.from(context.container.querySelectorAll<HTMLElement>(".metadata-add-button"))
				.find((element) => element.parentElement === context.container);
			if (nativeAddButton) context.container.insertBefore(toggle, nativeAddButton);
			else context.container.appendChild(toggle);
		}
		if (toggle.textContent !== label) toggle.textContent = label;
		toggle.setAttribute("aria-expanded", String(context.state.revealed));
		toggle.setAttribute("aria-label", label);
	}

	private syncReorderBar(context: MetadataContext): void {
		const session = context.state.reorderSession;
		if (!session?.active) {
			context.reorderBar?.remove();
			context.reorderBar = undefined;
			return;
		}

		let bar = context.reorderBar;
		if (!bar || !bar.isConnected) {
			bar = context.container.createDiv();
			bar.className = REORDER_BAR_CLASS;
				const label = bar.createSpan();
				label.className = `${REORDER_BAR_CLASS}-label`;
				const done = bar.createEl("button");
				done.type = "button";
				done.textContent = "Done";
				done.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					void this.commitReorderMode(context);
				});
			context.reorderBar = bar;
			const nativeAddButton = Array.from(context.container.querySelectorAll<HTMLElement>(".metadata-add-button"))
				.find((element) => element.parentElement === context.container);
			if (nativeAddButton) context.container.insertBefore(bar, nativeAddButton);
			else context.container.appendChild(bar);
		}
		const label = bar.querySelector<HTMLElement>(`.${REORDER_BAR_CLASS}-label`);
		if (label) {
			label.textContent = `Reordering · ${session.scope === "folders" ? "This folder" : "This vault"}`;
		}
	}

	private createAltGestureSnapshot(
		context: MetadataContext,
		row: HTMLElement,
		propertyKey: HTMLElement,
		event: MouseEvent | PointerEvent
	): AltGestureSnapshot {
		const propertyName = getPropertyKey(row);
		if (!propertyName) throw new Error("Property key is unavailable for Alt gesture");
		const file = context.state.view.file;
		if (!file) throw new Error("Markdown file is unavailable for Alt gesture");
		const notePath = context.state.noteKey;
		const rowState = context.rows.get(row);
		const cached = this.getCachedValue(context.state.view.file, propertyName);
		const empty = Boolean(rowState?.empty) || isRowEmpty(row, cached.value, cached.found);
		const resolution = resolvePropertyVisibility(this.plugin.settings, notePath, propertyName);
		const bounds = propertyKey.getBoundingClientRect();
		const snapshot: AltGestureSnapshot = {
			propertyName,
			file,
			row,
			propertyKey,
			notePath,
			folderPath: getContainingFolder(notePath),
			resolution,
			empty,
			wouldHide: this.wouldHideWithoutReveal(resolution.visibility, empty),
			revealed: context.state.revealed,
			editing: rowState?.editing || isRowEditing(row),
			startedAt: Date.now(),
			document: propertyKey.ownerDocument,
			x: Number.isFinite(event.clientX) ? event.clientX : bounds.left,
			y: Number.isFinite(event.clientY) ? event.clientY : bounds.bottom,
			width: bounds.width,
			menuOpened: false
		};
		return snapshot;
	}

	private isAltGestureUsable(snapshot: AltGestureSnapshot): boolean {
		return Date.now() - snapshot.startedAt <= 1000;
	}

	private openVisibilityMenu(context: MetadataContext, snapshot: AltGestureSnapshot): void {
		if (!this.isCurrentContext(context) || context.state.noteKey !== snapshot.notePath) return;

		try {
			const operation: ScopedPropertyVisibility = snapshot.wouldHide ? "show" : "hide";
			const menu = new Menu().setNoIcon();
			menu.addItem((item) => item.setTitle("Current visibility").setIsLabel(true));
			menu.addItem((item) => item
				.setTitle(`Effective: ${this.visibilityLabel(snapshot.resolution.visibility)} · ${this.sourceLabel(snapshot.resolution)}`)
				.setIsLabel(true));
			menu.addSeparator();

			this.addScopeMenu(
				menu, "This note", "notes", snapshot.notePath, snapshot.propertyName, operation
			);
			if (snapshot.folderPath) {
				this.addScopeMenu(
					menu, "This folder", "folders", snapshot.folderPath, snapshot.propertyName, operation
				);
			}
			this.addScopeMenu(
				menu, "This vault", "vault", "", snapshot.propertyName, operation
			);
			menu.addSeparator();
			menu.addItem((item) => item
				.setTitle("Delete from this note")
				.onClick(() => {
					void this.deletePropertyFromNote(context, snapshot);
				}));
			menu.addSeparator();
			menu.addItem((item) => item
				.setTitle("Reorder properties…")
				.onClick(() => {
					this.openReorderScopeChooser({
						document: snapshot.document,
						x: snapshot.x,
						y: snapshot.y,
						width: snapshot.width
					});
				}));

			menu.showAtPosition({
				x: snapshot.x,
				y: snapshot.y,
				width: snapshot.width
			}, snapshot.document);
			snapshot.menuOpened = true;
		} catch (error) {
			console.error("Compact Empty Properties: failed to open visibility menu", error);
		}
	}

	private async deletePropertyFromNote(
		context: MetadataContext,
		snapshot: AltGestureSnapshot
	): Promise<void> {
		try {
			if (snapshot.file.path !== snapshot.notePath) {
				throw new Error(`Gesture file changed from ${snapshot.notePath} to ${snapshot.file.path}`);
			}
			await this.app.fileManager.processFrontMatter(
				snapshot.file,
				(frontmatter: Record<string, unknown>) => {
					delete frontmatter[snapshot.propertyName];
				}
			);
			this.discardRuntimeProperty(context, snapshot.propertyName, snapshot.row);
			this.refreshAll();
		} catch (error) {
			reportError("delete action error", error);
		}
	}

	private discardRuntimeProperty(
		context: MetadataContext,
		propertyName: string,
		row: HTMLElement
	): void {
		const isTarget = (candidate: HTMLElement): boolean =>
			candidate === row || getPropertyKey(candidate) === propertyName;
		context.nativeRowOrder = context.nativeRowOrder?.filter((candidate) => !isTarget(candidate));
		context.originalRowOrder = context.originalRowOrder?.filter((candidate) => !isTarget(candidate));
		const session = context.state.reorderSession;
		if (session) {
			session.entryOrder = session.entryOrder.filter((candidate) => candidate !== propertyName);
			session.draftOrder = session.draftOrder.filter((candidate) => candidate !== propertyName);
		}
		for (const candidate of Array.from(context.rows.keys())) {
			if (isTarget(candidate)) context.rows.delete(candidate);
		}
		if (context.altGesture?.propertyName === propertyName) context.altGesture = undefined;
	}

	private addScopeMenu(
		menu: Menu,
		label: string,
		scope: ScopedRuleScope | "vault",
		scopePath: string,
		propertyName: string,
		visibility: ScopedPropertyVisibility
	): void {
		const operation = visibility === "show" ? "Show" : "Hide";
		const title = `${operation} in ${label.toLocaleLowerCase()}`;
		menu.addItem((item) => item
			.setTitle(title)
			.onClick(() => {
				void this.applyVisibilityAction(scope, scopePath, propertyName, visibility);
			}));
	}

	private async applyVisibilityAction(
		scope: ScopedRuleScope | "vault",
		scopePath: string,
		propertyName: string,
		visibility: ScopedPropertyVisibility
	): Promise<void> {
		try {
			if (scope === "vault") {
				await this.plugin.setPropertyVisibility(propertyName, visibility);
			} else {
				await this.plugin.setScopedPropertyVisibility(scope, scopePath, propertyName, visibility);
			}
		} catch (error) {
			reportError("show action error", error);
		}
	}

	private visibilityLabel(visibility: PropertyVisibility): string {
		if (visibility === "show") return "Show";
		if (visibility === "hide") return "Hide";
		return "Auto";
	}

	private sourceLabel(resolution: PropertyVisibilityResolution): string {
		if (resolution.source === "note") return "Note";
		if (resolution.source === "folder") return `Folder: ${resolution.folderPath}`;
		if (resolution.source === "vault") return "Vault";
		return "Auto";
	}

	/**
	 * Menu direction is based on semantic visibility before Reveal, not the
	 * row's current DOM class. Reveal deliberately makes a hidden row visible.
	 */
	private wouldHideWithoutReveal(
		visibility: PropertyVisibility,
		empty: boolean
	): boolean {
		if (visibility === "hide") return true;
		if (visibility === "show") return false;
		return this.plugin.settings.hideEmptyProperties && empty;
	}

	private scheduleApply(context: MetadataContext, generation: number, delay = 50): void {
		if (context.observerTimer !== undefined) return;
		context.observerTimer = window.setTimeout(() => {
			try {
				context.observerTimer = undefined;
				this.evaluateContext(context, generation);
			} catch (error) {
				context.observerTimer = undefined;
				reportError("scheduled apply error", error);
			}
		}, delay);
	}

	private scheduleResolve(state: ViewState, generation: number): void {
		if (!this.isCurrentGeneration(state, generation) || state.resolveFrame !== undefined) return;
		state.resolveFrame = window.requestAnimationFrame(() => {
			try {
				state.resolveFrame = undefined;
				if (!this.isCurrentGeneration(state, generation)) return;
				this.resolveView(state, generation);
			} catch (error) {
				state.resolveFrame = undefined;
				reportError("scheduled resolve error", error);
			}
		});
	}

	private findRow(target: EventTarget | null): HTMLElement | undefined {
		if (!isDomHTMLElement(target)) return undefined;
		return target.closest<HTMLElement>(PROPERTY_ROW_SELECTOR) ?? undefined;
	}

	private findPropertyKey(target: EventTarget | null): HTMLElement | undefined {
		if (!isDomHTMLElement(target)) return undefined;
		return target.closest<HTMLElement>(PROPERTY_KEY_SELECTOR) ?? undefined;
	}

	private getRowVisibility(context: MetadataContext, row: HTMLElement): PropertyVisibility {
		return resolvePropertyVisibility(
			this.plugin.settings,
			context.state.noteKey,
			getPropertyKey(row)
		).visibility;
	}

	private getCachedValue(file: TFile | null, key: string): { found: boolean; value: unknown } {
		if (!file) return { found: false, value: undefined };
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!isUnknownRecord(frontmatter) || !Object.prototype.hasOwnProperty.call(frontmatter, key)) {
			return { found: false, value: undefined };
		}
		return { found: true, value: frontmatter[key] };
	}

	private isEditingView(view: MarkdownView): boolean {
		const mode = typeof view.getMode === "function" ? view.getMode() : "source";
		return mode === "source" && view.file?.extension === "md";
	}

	private getNoteKey(view: MarkdownView): string {
		return view.file?.path ?? "";
	}

	private setRevealState(state: ViewState, value: boolean): void {
		const oldReveal = state.revealed;
		if (oldReveal === value) return;
		state.revealed = value;
	}

	private isCurrentGeneration(state: ViewState, generation: number): boolean {
		return this.viewStates.get(state.leaf) === state && state.generation.isCurrent(generation);
	}

	private isCurrentContext(context: MetadataContext): boolean {
		return this.isCurrentGeneration(context.state, context.generation) &&
			context.state.contexts.get(context.container) === context;
	}

	private cancelResolve(state: ViewState): void {
		if (state.resolveFrame === undefined) return;
		window.cancelAnimationFrame(state.resolveFrame);
		state.resolveFrame = undefined;
	}

	private destroyViewState(leaf: WorkspaceLeaf): void {
		const state = this.viewStates.get(leaf);
		if (!state) return;
		this.setRevealState(state, false);
		this.cancelResolve(state);
		state.rootObserver?.disconnect();
		state.reorderSession = undefined;
		for (const context of Array.from(state.contexts.values())) this.destroyContext(context);
		this.viewStates.delete(leaf);
	}

	private destroyContext(context: MetadataContext): void {
		if (context.state.contexts.get(context.container) !== context) return;
		context.observer.disconnect();
		if (context.drag?.handle.hasPointerCapture(context.drag.pointerId)) {
			context.drag.handle.releasePointerCapture(context.drag.pointerId);
		}
		context.drag = undefined;
		if (context.state.reorderSession) {
			context.state.reorderSession.dragActive = false;
		}
		context.altGesture = undefined;
		if (context.observerTimer !== undefined) {
			window.clearTimeout(context.observerTimer);
			context.observerTimer = undefined;
		}
		for (const timer of context.pendingBlurTimers) window.clearTimeout(timer);
		context.pendingBlurTimers.clear();
		for (const remove of context.removeListeners) remove();
		const restoreOrder = context.state.reorderSession?.active
			? undefined
			: context.nativeRowOrder ?? context.originalRowOrder;
		const currentRows = getPropertyRows(context.container);
		if (restoreOrder && context.container.isConnected) {
			const currentSet = new Set(currentRows);
			const restoredRows = restoreOrder.filter((row) => currentSet.has(row));
			const knownRows = new Set(restoredRows);
			for (const row of currentRows) {
				if (!knownRows.has(row)) {
					restoredRows.push(row);
					knownRows.add(row);
				}
			}
			this.reorderRowsInParent(restoredRows);
		}
		this.removeRevealMarkers(context);
		context.reorderBar?.remove();
		for (const row of new Set([...currentRows, ...context.rows.keys()])) {
			row.querySelector(`.${REORDER_HANDLE_CLASS}`)?.remove();
			row.querySelector(`.${CUSTOM_PROPERTY_ICON_CLASS}`)?.remove();
		}
		context.originalRowOrder = undefined;
		context.nativeRowOrder = undefined;
		for (const row of context.rows.keys()) {
			row.classList.remove(HIDDEN_CLASS);
			row.classList.remove(REVEALED_HIDDEN_CLASS);
			row.removeAttribute("data-compact-empty-properties-hidden");
			delete row.dataset.cepEditing;
		}
		context.toggle?.remove();
		context.rows.clear();
		context.state.contexts.delete(context.container);
	}
}

class PropertyIconPickerModal extends Modal {
	private iconIds: IconName[] = [];

	constructor(
		app: App,
		private readonly propertyName: string,
		private readonly onSelect: (iconId: string | undefined) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(`Choose icon · ${this.propertyName}`);
		const contentEl = this.contentEl;
		while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);

		this.iconIds = Array.from(new Set(getIconIds()))
			.filter((iconId) => getIcon(iconId) !== null)
			.sort((left, right) => left.localeCompare(right));

		const search = contentEl.createEl("input");
		search.type = "search";
		search.className = "compact-empty-properties-icon-search";
		search.placeholder = "Search icons...";
		search.setAttribute("aria-label", "Search icons");
		contentEl.appendChild(search);

		const reset = contentEl.createEl("button");
		reset.type = "button";
		reset.className = "compact-empty-properties-icon-reset";
		reset.textContent = "Reset to native/default";
		reset.addEventListener("click", () => {
			this.onSelect(undefined);
			this.close();
		});
		contentEl.appendChild(reset);

		const resultEl = contentEl.createDiv();
		resultEl.className = "compact-empty-properties-icon-results";
		resultEl.setAttribute("role", "listbox");
		contentEl.appendChild(resultEl);

		const renderResults = (): void => {
			while (resultEl.firstChild) resultEl.removeChild(resultEl.firstChild);
			const query = search.value.trim().toLocaleLowerCase();
			const matches = this.iconIds.filter((iconId) => iconId.toLocaleLowerCase().includes(query));
			const limit = query ? 240 : 120;
			for (const iconId of matches.slice(0, limit)) {
				const item = resultEl.createEl("button");
				item.type = "button";
				item.className = "compact-empty-properties-icon-option";
				item.setAttribute("role", "option");
				item.setAttribute("aria-label", iconId);

				const preview = item.createSpan();
				preview.className = "compact-empty-properties-icon-preview";
				preview.setAttribute("aria-hidden", "true");
				setIcon(preview, iconId);
				item.appendChild(preview);

				const label = item.createSpan();
				label.textContent = iconId;
				item.appendChild(label);
				item.addEventListener("click", () => {
					this.onSelect(iconId);
					this.close();
				});
			}

			if (matches.length === 0) {
				const empty = resultEl.createDiv();
				empty.className = "compact-empty-properties-visibility-empty";
				empty.textContent = "No matching icons.";
			} else if (matches.length > limit) {
				const hint = resultEl.createDiv();
				hint.className = "compact-empty-properties-icon-results-hint";
				hint.textContent = `Showing ${limit} of ${matches.length}. Refine your search.`;
			}
		};

		search.addEventListener("input", renderResults);
		renderResults();
		window.setTimeout(() => search.focus(), 0);

		const footer = contentEl.createDiv();
		footer.className = "compact-empty-properties-icon-footer";
		const cancel = footer.createEl("button");
		cancel.type = "button";
		cancel.textContent = "Cancel";
		cancel.addEventListener("click", () => this.close());
	}

	onClose(): void {
		while (this.contentEl.firstChild) this.contentEl.removeChild(this.contentEl.firstChild);
	}
}

class CompactEmptyPropertiesSettingTab extends PluginSettingTab {
	private propertyNames: string[] = [];
	private propertySearch = "";
	private propertyListEl: HTMLElement | undefined;
	private iconPropertyNames: string[] = [];
	private iconSearch = "";
	private iconListEl: HTMLElement | undefined;
	private orderSearch = "";
	private orderListEl: HTMLElement | undefined;
	private scopedSearch = "";
	private scopedListEl: HTMLElement | undefined;

	constructor(app: App, private readonly plugin: CompactEmptyPropertiesPlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [{
			name: "Compact Empty Properties",
			desc: "Hide, reveal, customize, and reorder Properties without changing Markdown.",
			aliases: [
				"Hide empty properties",
				"Property visibility",
				"Property icons",
				"Property order",
				"Scoped rules"
			],
			render: (setting) => this.renderImperativeSettings(setting.settingEl)
		}];
	}

	display(): void {
		this.renderImperativeSettings(this.containerEl);
	}

	private renderImperativeSettings(containerEl: HTMLElement): void {
		containerEl.empty();
		new Setting(containerEl)
			.setName("Hide empty properties")
			.setDesc("Hide empty Properties rows in Markdown editing views. This never changes note data.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.hideEmptyProperties)
				.onChange((value) => this.plugin.setHideEmptyProperties(value)));

		new Setting(containerEl)
			.setName("Property visibility")
			.setDesc("Vault-wide visibility rules. These settings only change the Properties UI.")
			.setHeading();

		new Setting(containerEl)
			.setName("Search property name")
			.addSearch((search) => search
				.setPlaceholder("Search properties")
				.setValue(this.propertySearch)
				.onChange((value) => {
					this.propertySearch = value;
					this.renderPropertyRows();
				}));

		this.propertyListEl = containerEl.createDiv({ cls: "compact-empty-properties-visibility-list" });

		new Setting(containerEl)
			.setName("Property icons")
			.setDesc("Vault-wide decorative icons. These settings only change the Properties UI.")
			.setHeading();

		new Setting(containerEl)
			.setName("Search properties")
			.addSearch((search) => search
				.setPlaceholder("Search properties")
				.setValue(this.iconSearch)
				.onChange((value) => {
					this.iconSearch = value;
					this.renderIconRows();
				}));

		this.iconListEl = containerEl.createDiv({ cls: "compact-empty-properties-icon-list" });

		new Setting(containerEl)
			.setName("Property order")
			.setDesc("UI-only order rules. Reorder from the Command palette.")
			.setHeading();

		new Setting(containerEl)
			.setName("Search property orders")
			.addSearch((search) => search
				.setPlaceholder("Search paths or properties")
				.setValue(this.orderSearch)
				.onChange((value) => {
					this.orderSearch = value;
					this.refreshOrderRules();
				}));

		this.orderListEl = containerEl.createDiv({ cls: "compact-empty-properties-order-list" });

		new Setting(containerEl)
			.setName("Scoped rules")
			.setDesc("Note and folder rules. Reset removes the scoped rule and restores inheritance.")
			.setHeading();

		new Setting(containerEl)
			.setName("Search scoped rules")
			.addSearch((search) => search
				.setPlaceholder("Search paths or properties")
				.setValue(this.scopedSearch)
				.onChange((value) => {
					this.scopedSearch = value;
					this.refreshScopedRules();
				}));

		this.scopedListEl = containerEl.createDiv({ cls: "compact-empty-properties-scoped-list" });
		this.refreshAll();
	}

	refreshAll(): void {
		this.refreshPropertyNames();
		this.refreshOrderRules();
		this.refreshScopedRules();
	}

	refreshPropertyNames(): void {
		if (!this.propertyListEl) return;

		const names = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!frontmatter) continue;
			for (const propertyName of Object.keys(frontmatter)) names.add(propertyName);
		}
		for (const propertyName of Object.keys(this.plugin.settings.propertyVisibility)) {
			names.add(propertyName);
		}

		this.propertyNames = Array.from(names).sort((left, right) => left.localeCompare(right));
		this.iconPropertyNames = mergePropertyIconNames(names, Object.keys(this.plugin.settings.propertyIcons));
		this.renderPropertyRows();
		this.renderIconRows();
	}

	private refreshOrderRules(): void {
		const listEl = this.orderListEl;
		if (!listEl) return;
		while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

		const query = this.orderSearch.trim().toLocaleLowerCase();
		const vaultMatches = this.plugin.settings.propertyOrder.length > 0 &&
			(`vault ${this.plugin.settings.propertyOrder.join(" ")}`.toLocaleLowerCase().includes(query));
		const folderEntries = Object.entries(this.plugin.settings.scopedPropertyOrder.folders)
			.filter(([path, order]) => `${path} ${order.join(" ")}`.toLocaleLowerCase().includes(query))
			.sort(([left], [right]) => left.localeCompare(right));

		if (!vaultMatches && folderEntries.length === 0) {
			const emptyState = listEl.createDiv();
			emptyState.className = "compact-empty-properties-visibility-empty";
			emptyState.textContent = query ? "No matching property orders." : "No property orders.";
			return;
		}

		if (vaultMatches) {
			new Setting(listEl)
				.setName("Vault order")
				.setDesc(this.plugin.settings.propertyOrder.join(" → "))
				.addButton((button) => button
					.setButtonText("Reset")
					.setTooltip("Reset Vault property order")
					.onClick(() => void this.plugin.resetVaultPropertyOrder()));
		}

		for (const [path, order] of folderEntries) {
			new Setting(listEl)
				.setName(path)
				.setDesc(order.join(" → "))
				.addButton((button) => button
					.setButtonText("Reset")
					.setTooltip(`Reset property order for ${path}`)
					.onClick(() => void this.plugin.resetFolderPropertyOrder(path)));
		}
	}

	private refreshScopedRules(): void {
		const listEl = this.scopedListEl;
		if (!listEl) return;
		while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

		const query = this.scopedSearch.trim().toLocaleLowerCase();
		const entries: Array<{
			scope: ScopedRuleScope;
			path: string;
			propertyName: string;
			visibility: ScopedPropertyVisibility;
		}> = [];
		for (const scope of ["notes", "folders"] as const) {
			for (const [path, rules] of Object.entries(this.plugin.settings.scopedPropertyVisibility[scope])) {
				for (const [propertyName, visibility] of Object.entries(rules)) {
					entries.push({ scope, path, propertyName, visibility });
				}
			}
		}

		const filtered = entries
			.filter((entry) => `${entry.path} ${entry.propertyName}`.toLocaleLowerCase().includes(query))
			.sort((left, right) =>
				left.scope.localeCompare(right.scope) ||
				left.path.localeCompare(right.path) ||
				left.propertyName.localeCompare(right.propertyName)
			);
		if (filtered.length === 0) {
			const emptyState = listEl.createDiv();
			emptyState.className = "compact-empty-properties-visibility-empty";
			emptyState.textContent = query ? "No matching scoped rules." : "No scoped rules.";
			return;
		}

		for (const scope of ["notes", "folders"] as const) {
			const scopeEntries = filtered.filter((entry) => entry.scope === scope);
			if (scopeEntries.length === 0) continue;
			new Setting(listEl)
				.setName(scope === "notes" ? "Notes" : "Folders")
				.setHeading();
			for (const entry of scopeEntries) {
				new Setting(listEl)
					.setName(entry.path)
					.setDesc(`${entry.propertyName} · ${this.getVisibilityLabel(entry.visibility)}`)
					.addButton((button) => button
						.setButtonText("Reset")
						.setTooltip(`Reset ${entry.propertyName} for ${entry.path}`)
						.onClick(() => this.plugin.resetScopedPropertyVisibility(
							entry.scope,
							entry.path,
							entry.propertyName
						)));
			}
		}
	}

	private renderPropertyRows(): void {
		const listEl = this.propertyListEl;
		if (!listEl) return;
		while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

		const query = this.propertySearch.trim().toLocaleLowerCase();
		const propertyNames = this.propertyNames.filter((propertyName) =>
			propertyName.toLocaleLowerCase().includes(query)
		);
		if (propertyNames.length === 0) {
			const emptyState = listEl.createDiv();
			emptyState.className = "compact-empty-properties-visibility-empty";
			emptyState.textContent = query
				? "No matching properties."
				: "No properties found in the current Vault.";
			return;
		}

		for (const propertyName of propertyNames) this.renderPropertyRow(listEl, propertyName);
	}

	private renderIconRows(): void {
		const listEl = this.iconListEl;
		if (!listEl) return;
		while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

		const query = this.iconSearch.trim().toLocaleLowerCase();
		const propertyNames = this.iconPropertyNames.filter((propertyName) =>
			propertyName.toLocaleLowerCase().includes(query)
		);
		if (propertyNames.length === 0) {
			const emptyState = listEl.createDiv();
			emptyState.className = "compact-empty-properties-visibility-empty";
			emptyState.textContent = query
				? "No matching properties."
				: "No properties found in the current Vault.";
			return;
		}

		for (const propertyName of propertyNames) this.renderIconRow(listEl, propertyName);
	}

	private renderIconRow(listEl: HTMLElement, propertyName: string): void {
		const iconId = getPropertyIcon(this.plugin.settings.propertyIcons, propertyName);
		const setting = new Setting(listEl)
			.setName(propertyName)
			.setClass("compact-empty-properties-icon-row");

		const preview = setting.controlEl.createSpan();
		preview.className = "compact-empty-properties-icon-preview";
		preview.setAttribute("aria-hidden", "true");
		if (iconId && getIcon(iconId) !== null) setIcon(preview, iconId);

		setting.addButton((button) => button
			.setButtonText("Change")
			.setTooltip(`Change icon for ${propertyName}`)
			.onClick(() => {
				new PropertyIconPickerModal(
					this.app,
					propertyName,
					(selectedIcon) => {
						if (selectedIcon === undefined) void this.plugin.resetPropertyIcon(propertyName);
						else void this.plugin.setPropertyIcon(propertyName, selectedIcon);
					}
				).open();
			}));

		if (iconId !== undefined) {
			setting.addButton((button) => button
				.setButtonText("Reset")
				.setTooltip(`Reset icon for ${propertyName}`)
				.onClick(() => void this.plugin.resetPropertyIcon(propertyName)));
		}
	}

	private renderPropertyRow(listEl: HTMLElement, propertyName: string): void {
		const visibility = getPropertyVisibility(
			this.plugin.settings.propertyVisibility,
			propertyName
		);
		const setting = new Setting(listEl)
			.setName(propertyName)
			.setClass("compact-empty-properties-visibility-row");

		for (const mode of PROPERTY_VISIBILITY_MODES) {
			setting.addButton((button) => {
				button
					.setButtonText(this.getVisibilityLabel(mode))
					.setClass("compact-empty-properties-visibility-button")
					.setTooltip(`Set ${propertyName} to ${this.getVisibilityLabel(mode)}`)
					.onClick(() => this.plugin.setPropertyVisibility(propertyName, mode));
				button.buttonEl.setAttribute("aria-pressed", String(visibility === mode));
			});
		}
	}

	private getVisibilityLabel(visibility: PropertyVisibility): string {
		if (visibility === "show") return "Show";
		if (visibility === "hide") return "Hide";
		return "Auto";
	}
}
