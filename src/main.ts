import {
	App,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile
} from "obsidian";
import {
	getPropertyKey,
	getPropertyRows,
	isRowEditing,
	isRowEmpty,
	HIDDEN_CLASS,
	METADATA_CONTAINER_SELECTOR,
	PROPERTY_ROW_SELECTOR,
	TOGGLE_CLASS
} from "./dom-adapter";
import { toggleText } from "./empty-state";
import { GenerationToken } from "./lifecycle";

interface CompactEmptyPropertiesSettings {
	hideEmptyProperties: boolean;
}

const DEFAULT_SETTINGS: CompactEmptyPropertiesSettings = {
	hideEmptyProperties: true
};

interface RowState {
	editing: boolean;
	empty: boolean;
	newlyCreated: boolean;
}

interface ViewState {
	view: MarkdownView;
	root: HTMLElement;
	noteKey: string;
	generation: GenerationToken;
	rootObserver: MutationObserver;
	resolveFrame: number | undefined;
	retryCount: number;
	contexts: Map<HTMLElement, MetadataContext>;
}

interface MetadataContext {
	state: ViewState;
	container: HTMLElement;
	generation: number;
	observer: MutationObserver;
	observerTimer: number | undefined;
	initialized: boolean;
	expanded: boolean;
	rows: Map<HTMLElement, RowState>;
	toggle: HTMLButtonElement | undefined;
	removeListeners: Array<() => void>;
	pendingBlurTimers: Set<number>;
}

export default class CompactEmptyPropertiesPlugin extends Plugin {
	settings: CompactEmptyPropertiesSettings = DEFAULT_SETTINGS;
	controller!: PropertiesController;

	async onload(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.controller = new PropertiesController(this.app, this);

		this.addSettingTab(new CompactEmptyPropertiesSettingTab(this.app, this));
		this.registerEvent(this.app.workspace.on("layout-change", () => this.controller.refreshAll()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.controller.refreshAll()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.controller.refreshAll()));
		this.registerEvent(this.app.metadataCache.on("changed", () => this.controller.refreshAll()));
		this.app.workspace.onLayoutReady(() => this.controller.refreshAll());
	}

	async setHideEmptyProperties(value: boolean): Promise<void> {
		this.settings.hideEmptyProperties = value;
		await this.saveData(this.settings);
		this.controller.refreshAll();
	}

	onunload(): void {
		this.controller?.destroy();
	}
}

class PropertiesController {
	private readonly viewStates = new Map<MarkdownView, ViewState>();
	private readonly maxResolveRetries = 8;

	constructor(
		private readonly app: App,
		private readonly plugin: CompactEmptyPropertiesPlugin
	) {}

	refreshAll(): void {
		const seenViews = new Set<MarkdownView>();
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) return;
			seenViews.add(view);
			if (!this.isEditingView(view)) {
				this.destroyViewState(view);
				return;
			}

			const state = this.ensureViewState(view);
		this.syncViewIdentity(state);
			this.resolveView(state, state.generation.current());
		});

		for (const view of Array.from(this.viewStates.keys())) {
			if (!seenViews.has(view)) this.destroyViewState(view);
		}
	}

	destroy(): void {
		for (const view of Array.from(this.viewStates.keys())) this.destroyViewState(view);
	}

	private ensureViewState(view: MarkdownView): ViewState {
		const existing = this.viewStates.get(view);
		if (existing && existing.root === view.containerEl) return existing;
		if (existing) this.destroyViewState(view);

		let state: ViewState;
		const rootObserver = new MutationObserver(() => {
			if (this.viewStates.get(view) !== state) return;
			if (this.findMetadataContainers(state.root).length > 0) state.retryCount = 0;
			this.scheduleResolve(state, state.generation.current());
		});
		state = {
			view,
			root: view.containerEl,
			noteKey: this.getNoteKey(view),
			generation: new GenerationToken(),
			rootObserver,
			resolveFrame: undefined,
			retryCount: 0,
			contexts: new Map()
		};
		this.viewStates.set(view, state);
		rootObserver.observe(state.root, { childList: true, subtree: true });
		return state;
	}

	private syncViewIdentity(state: ViewState): number {
		const noteKey = this.getNoteKey(state.view);
		if (state.noteKey === noteKey) return state.generation.current();

		state.noteKey = noteKey;
		const generation = state.generation.invalidate();
		this.cancelResolve(state);
		state.retryCount = 0;
		for (const context of Array.from(state.contexts.values())) this.destroyContext(context);
		return generation;
	}

	private resolveView(state: ViewState, generation: number): void {
		if (!this.isCurrentGeneration(state, generation)) return;

		if (this.getNoteKey(state.view) !== state.noteKey) {
			const nextGeneration = this.syncViewIdentity(state);
			this.resolveView(state, nextGeneration);
			return;
		}

		const containers = this.findMetadataContainers(state.root);
		const currentContainers = new Set(containers);
		for (const [container, context] of Array.from(state.contexts.entries())) {
			if (!currentContainers.has(container) || !container.isConnected) this.destroyContext(context);
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
			if (!this.isCurrentContext(context)) return;
			this.scheduleApply(context, generation);
		});
		context = {
			state,
			container,
			generation,
			observer,
			observerTimer: undefined,
			initialized: false,
			expanded: false,
			rows: new Map(),
			toggle: undefined,
			removeListeners: [],
			pendingBlurTimers: new Set()
		};
		state.contexts.set(container, context);

		const onFocusIn = (event: FocusEvent): void => {
			const row = this.findRow(event.target);
			if (!row || !this.isCurrentContext(context)) return;
			const rowState = context.rows.get(row) ?? { editing: false, empty: false, newlyCreated: false };
			rowState.editing = true;
			row.dataset.cepEditing = "true";
			context.rows.set(row, rowState);
			row.classList.remove(HIDDEN_CLASS);
			this.scheduleApply(context, generation);
		};
		const onFocusOut = (event: FocusEvent): void => {
			const row = this.findRow(event.target);
			if (!row || !this.isCurrentContext(context)) return;
			const blurTimer = window.setTimeout(() => {
				context.pendingBlurTimers.delete(blurTimer);
				if (!this.isCurrentContext(context) || row.contains(row.ownerDocument.activeElement)) return;
				const rowState = context.rows.get(row);
				if (!rowState) return;
				rowState.editing = false;
				rowState.newlyCreated = false;
				delete row.dataset.cepEditing;
				this.evaluateContext(context, generation);
			}, 0);
			context.pendingBlurTimers.add(blurTimer);
		};
		const onValueChange = (): void => {
			if (this.isCurrentContext(context)) this.scheduleApply(context, generation);
		};

		container.addEventListener("focusin", onFocusIn);
		container.addEventListener("focusout", onFocusOut);
		container.addEventListener("input", onValueChange);
		container.addEventListener("change", onValueChange);
		container.addEventListener("blur", onValueChange, true);
		context.removeListeners.push(
			() => container.removeEventListener("focusin", onFocusIn),
			() => container.removeEventListener("focusout", onFocusOut),
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
		this.apply(context);
	}

	private apply(context: MetadataContext): void {
		if (!this.isCurrentContext(context)) return;
		if (!context.container.isConnected) {
			this.destroyContext(context);
			return;
		}
		if (!this.plugin.settings.hideEmptyProperties) context.expanded = false;

		const currentRows = getPropertyRows(context.container);
		const currentSet = new Set(currentRows);
		for (const row of Array.from(context.rows.keys())) {
			if (!currentSet.has(row)) context.rows.delete(row);
		}

		const rowRecords: Array<{ row: HTMLElement; empty: boolean; hidden: boolean }> = [];
		for (const row of currentRows) {
			const rowState = context.rows.get(row) ?? {
				editing: isRowEditing(row),
				empty: false,
				newlyCreated: context.initialized
			};
			const editing = rowState.editing || isRowEditing(row);
			rowState.editing = editing;
			const key = getPropertyKey(row);
			const cached = key
				? this.getCachedValue(context.state.view.file, key)
				: { found: false, value: undefined };
			const empty = isRowEmpty(row, cached.value, cached.found);
			rowState.empty = empty;
			context.rows.set(row, rowState);

			const hidden = this.plugin.settings.hideEmptyProperties && !context.expanded && empty &&
				!editing && !rowState.newlyCreated;
			row.classList.toggle(HIDDEN_CLASS, hidden);
			if (!hidden) row.removeAttribute("data-compact-empty-properties-hidden");
			else row.setAttribute("data-compact-empty-properties-hidden", "true");
			rowRecords.push({ row, empty, hidden });
		}
		context.initialized = true;

		this.syncToggle(context, rowRecords);
	}

	private syncToggle(
		context: MetadataContext,
		rowRecords: Array<{ row: HTMLElement; empty: boolean; hidden: boolean }>
	): void {
		const emptyCount = rowRecords.filter((record) => record.empty).length;
		if (!this.plugin.settings.hideEmptyProperties || emptyCount === 0) {
			context.toggle?.remove();
			context.toggle = undefined;
			return;
		}

		const hiddenCount = rowRecords.filter((record) => record.hidden).length;
		const label = toggleText(context.expanded, hiddenCount);
		let toggle = context.toggle;
		if (!toggle || !toggle.isConnected) {
			toggle = context.container.ownerDocument.createElement("button");
			toggle.type = "button";
			toggle.className = TOGGLE_CLASS;
			toggle.setAttribute("aria-live", "polite");
			toggle.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				context.expanded = !context.expanded;
				this.evaluateContext(context, context.generation);
			});
			context.toggle = toggle;
			const nativeAddButton = Array.from(context.container.querySelectorAll<HTMLElement>(".metadata-add-button"))
				.find((element) => element.parentElement === context.container);
			if (nativeAddButton) context.container.insertBefore(toggle, nativeAddButton);
			else context.container.appendChild(toggle);
		}
		if (toggle.textContent !== label) toggle.textContent = label;
		toggle.setAttribute("aria-expanded", String(context.expanded));
		toggle.setAttribute("aria-label", label);
	}

	private scheduleApply(context: MetadataContext, generation: number): void {
		if (context.observerTimer !== undefined) window.clearTimeout(context.observerTimer);
		context.observerTimer = window.setTimeout(() => {
			context.observerTimer = undefined;
			this.evaluateContext(context, generation);
		}, 50);
	}

	private scheduleResolve(state: ViewState, generation: number): void {
		if (!this.isCurrentGeneration(state, generation) || state.resolveFrame !== undefined) return;
		state.resolveFrame = window.requestAnimationFrame(() => {
			state.resolveFrame = undefined;
			if (!this.isCurrentGeneration(state, generation)) return;
			this.resolveView(state, generation);
		});
	}

	private findRow(target: EventTarget | null): HTMLElement | undefined {
		if (!(target instanceof HTMLElement)) return undefined;
		return target.closest<HTMLElement>(PROPERTY_ROW_SELECTOR) ?? undefined;
	}

	private getCachedValue(file: TFile | null, key: string): { found: boolean; value: unknown } {
		if (!file) return { found: false, value: undefined };
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		if (!frontmatter || !Object.prototype.hasOwnProperty.call(frontmatter, key)) {
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

	private isCurrentGeneration(state: ViewState, generation: number): boolean {
		return this.viewStates.get(state.view) === state && state.generation.isCurrent(generation);
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

	private destroyViewState(view: MarkdownView): void {
		const state = this.viewStates.get(view);
		if (!state) return;
		this.cancelResolve(state);
		state.rootObserver.disconnect();
		for (const context of Array.from(state.contexts.values())) this.destroyContext(context);
		this.viewStates.delete(view);
	}

	private destroyContext(context: MetadataContext): void {
		if (context.state.contexts.get(context.container) !== context) return;
		context.observer.disconnect();
		if (context.observerTimer !== undefined) window.clearTimeout(context.observerTimer);
		for (const timer of context.pendingBlurTimers) window.clearTimeout(timer);
		context.pendingBlurTimers.clear();
		for (const remove of context.removeListeners) remove();
		for (const row of context.rows.keys()) {
			row.classList.remove(HIDDEN_CLASS);
			row.removeAttribute("data-compact-empty-properties-hidden");
			delete row.dataset.cepEditing;
		}
		context.toggle?.remove();
		context.rows.clear();
		context.state.contexts.delete(context.container);
	}
}

class CompactEmptyPropertiesSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: CompactEmptyPropertiesPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl)
			.setName("Hide empty properties")
			.setDesc("Hide empty Properties rows in Markdown editing views. This never changes note data.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.hideEmptyProperties)
				.onChange((value) => this.plugin.setHideEmptyProperties(value)));
	}
}
