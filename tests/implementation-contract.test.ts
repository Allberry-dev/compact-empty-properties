import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/main.ts"), "utf8");
const domAdapter = readFileSync(join(here, "../src/dom-adapter.ts"), "utf8");
const emptyState = readFileSync(join(here, "../src/empty-state.ts"), "utf8");
const propertyIcons = readFileSync(join(here, "../src/property-icons.ts"), "utf8");
const propertyOrder = readFileSync(join(here, "../src/property-order.ts"), "utf8");
const styles = readFileSync(join(here, "../styles.css"), "utf8");

test("the runtime is scoped to Markdown editing metadata containers", () => {
	assert.match(source, /METADATA_CONTAINER_SELECTOR/);
	assert.match(source, /view\.getMode\(\).*source/);
	assert.doesNotMatch(source, /getMode\(\).*preview/);
	assert.match(source, /observer\.observe\(container/);
	assert.match(source, /childList: true/);
	assert.match(source, /subtree: true/);
	assert.match(source, /characterData: true/);
	assert.doesNotMatch(source, /attributes:\s*true/);
});

test("note switching uses bounded resolution, immediate evaluation, and one context per container", () => {
	assert.match(source, /GenerationToken/);
	assert.match(source, /generation\.invalidate\(\)/);
	assert.match(source, /requestAnimationFrame/);
	assert.match(source, /maxResolveRetries = 8/);
	assert.match(source, /First evaluation is synchronous/);
	assert.match(source, /this\.evaluateContext\(context, generation\)/);
	assert.match(source, /contexts: Map<HTMLElement, MetadataContext>/);
	assert.match(source, /state\.contexts\.set\(container, context\)/);
	assert.match(source, /state\.contexts\.delete\(context\.container\)/);
	assert.match(source, /cancelAnimationFrame/);
});

test("the implementation keeps native add-property UI and uses only public CEP delete mutation", () => {
	assert.match(source, /metadata-add-button/);
	assert.match(source, /insertBefore\(toggle, nativeAddButton\)/);
	assert.doesNotMatch(source, /(?:vault|Vault)\.modify/);
	assert.match(source, /fileManager\.processFrontMatter/);
	assert.match(source, /delete frontmatter\[snapshot\.propertyName\]/);
	assert.doesNotMatch(source, /frontmatter.*stringify|serialize.*frontmatter/i);
});

test("property visibility is vault-wide, settings-backed, and applied through the controller", () => {
	assert.match(source, /property-visibility/);
	assert.match(source, /propertyVisibility/);
	assert.match(source, /getMarkdownFiles\(\)/);
	assert.match(source, /metadataCache\.getFileCache/);
	assert.match(source, /shouldHideProperty/);
	assert.match(source, /setPropertyVisibility/);
	assert.match(source, /PROPERTY_VISIBILITY_MODES/);
	assert.doesNotMatch(source, /(?:vault|Vault)\.modify/);
});

test("V2 uses Alt-click on the Property key and public Menu without action or probe UI", () => {
	assert.match(source, /event\.altKey/);
	assert.match(source, /Delete from this note/);
	assert.match(source, /deletePropertyFromNote/);
	assert.match(source, /snapshot\.file/);
	assert.match(source, /discardRuntimeProperty/);
	assert.match(source, /findPropertyKey/);
	assert.match(source, /PROPERTY_KEY_SELECTOR/);
	assert.match(source, /container\.addEventListener\("click", onRowClick, true\)/);
	assert.match(source, /openVisibilityMenu\(context, snapshot\)/);
	assert.match(source, /new Menu\(\)\.setNoIcon\(\)/);
	assert.match(source, /showAtPosition\(/);
	assert.match(source, /propertyKey\.ownerDocument/);
	assert.match(source, /hiddenWithoutReveal/);
	assert.match(source, /wouldHideWithoutReveal/);
	assert.match(source, /REVEALED_HIDDEN_CLASS/);
	assert.match(source, /REVEAL_SEPARATOR_CLASS/);
	assert.match(source, /REVEAL_GROUP_LABEL_CLASS/);
	assert.match(source, /REVEAL_AUTO_SEPARATOR_CLASS/);
	assert.match(source, /originalRowOrder/);
	assert.match(source, /reorderRevealedRows/);
	assert.match(source, /restoreOriginalRowOrder/);
	assert.match(source, /reorderRowsInParent/);
	assert.match(source, /visibleRecords\.concat\(manualRecords, autoRecords\)/);
	assert.match(source, /manualRecords/);
	assert.match(source, /autoRecords/);
	assert.match(source, /manualHideSequence/);
	assert.match(source, /getManualHideSequence/);
	assert.match(source, /getPropertyRows\(context\.container\)/);
	assert.match(source, /syncRevealSeparators/);
	assert.match(source, /setAttribute\("role", "separator"\)/);
	assert.match(source, /Manual hidden/);
	assert.match(source, /Auto hidden/);
	assert.match(source, /removeRevealMarkers/);
	assert.doesNotMatch(source, /cloneNode/);
	assert.match(source, /operation: ScopedPropertyVisibility/);
	assert.match(source, /setScopedPropertyVisibility/);
	assert.match(source, /resolvePropertyVisibility/);
	assert.match(source, /state\.revealed/);
	assert.match(emptyState, /显示隐藏属性/);
	assert.match(source, /refreshScopedRules/);
	assert.match(source, /resetScopedPropertyVisibility/);
	assert.match(source, /migrateNoteRulesUnderFolderPath/);
	assert.doesNotMatch(source, /console\.(log|debug|info)/);
	assert.doesNotMatch(source, /ACTION_CLASS|syncAction|activeRow|document capture|raw action/);
	assert.doesNotMatch(source, /registerDomEvent/);
	assert.doesNotMatch(source, /workspace\.on\("editor-menu"/);
	assert.doesNotMatch(source, /Menu\.forEvent/);
	assert.doesNotMatch(source, /addEventListener\("contextmenu"/);
	assert.match(source, /removeEventListener\("click", onRowClick, true\)/);
});

test("disable and reload cleanup hooks are present", () => {
	assert.match(source, /onunload\(\): void/);
	assert.match(source, /controller\?\.destroy\(\)/);
	assert.match(source, /observer\.disconnect\(\)/);
	assert.match(source, /context\.toggle\?\.remove\(\)/);
	assert.match(source, /row\.classList\.remove\(HIDDEN_CLASS\)/);
});

test("S1 lifecycle work is coalesced without starvation and failures are contained", () => {
	assert.match(source, /if \(context\.observerTimer !== undefined\) return/);
	assert.match(source, /context\.initialized && isRowEditing\(row\)/);
	assert.match(source, /NEW_PROPERTY_GRACE_MS/);
	assert.match(source, /creationGraceUntil/);
	assert.match(source, /isDomHTMLElement\(target\)/);
	assert.match(domAdapter, /export function isDomHTMLElement/);
	assert.doesNotMatch(source, /instanceof HTMLElement|instanceof Node/);
	assert.doesNotMatch(domAdapter, /instanceof HTMLElement|instanceof Node/);
	assert.match(source, /private setRevealState\(state: ViewState, value: boolean\)/);
	assert.match(source, /Map<WorkspaceLeaf, ViewState>/);
	assert.match(source, /hasNativePropertyInteraction/);
	assert.match(source, /if \(!context\.container\.isConnected\)/);
	assert.match(source, /context\.observer\.disconnect\(\)/);
	assert.match(source, /context\.rows\.delete\(row\)/);
	assert.match(source, /rows\.some\(\(row\) => !row\.isConnected\)/);
	assert.match(source, /reportError\(/);
	assert.doesNotMatch(source, /console\.(log|debug|info)/);
});

test("theme styling uses Obsidian variables and remains lightweight", () => {
	assert.match(styles, /var\(--text-muted\)/);
	assert.match(styles, /var\(--background-modifier-hover\)/);
	assert.match(styles, /compact-empty-properties-reveal-separator/);
	assert.match(styles, /var\(--background-modifier-border\)/);
	assert.doesNotMatch(styles, /#[0-9a-f]{3,8}/i);
	assert.doesNotMatch(styles, /position:\s*(fixed|absolute)/);
});

test("scanner cleanup keeps settings searchable and DOM creation cross-window safe", () => {
	assert.match(source, /getSettingDefinitions\(\): SettingDefinitionItem\[\]/);
	assert.match(source, /createEl\(/);
	assert.match(source, /createDiv\(/);
	assert.match(source, /createSpan\(/);
	assert.doesNotMatch(source, /ownerDocument\.createElement/);
	assert.doesNotMatch(domAdapter, /instanceof HTMLElement|instanceof Node/);
	assert.doesNotMatch(styles, /!important/);
});

test("property icons use an independent decorative sibling and public icon APIs", () => {
	assert.match(propertyIcons, /normalizePropertyIcons/);
	assert.match(propertyIcons, /mergePropertyIconNames/);
	assert.match(source, /propertyIcons/);
	assert.match(source, /getIconIds\(\)/);
	assert.match(source, /getIcon\(iconId\) === null/);
	assert.match(source, /setIcon\(customIcon, iconId/);
	assert.match(source, /CUSTOM_PROPERTY_ICON_CLASS/);
	assert.match(source, /data-cep-custom-icon/);
	assert.match(source, /getPropertyKeyEditableAnchor/);
	assert.match(source, /getCustomPropertyIconAnchor/);
	assert.match(source, /getNativePropertyIconAnchor/);
	assert.match(domAdapter, /NATIVE_PROPERTY_ICON_SELECTOR/);
	assert.match(source, /propertyKey\.insertBefore\(customIcon, anchor\)/);
	assert.match(styles, /cep-property-custom-icon/);
	assert.match(styles, /pointer-events:\s*none/);
	assert.doesNotMatch(source, /customIcon[^\n]*metadata-property-icon/);
	assert.doesNotMatch(propertyIcons, /metadata-property-icon/);
	assert.doesNotMatch(source, /cloneNode/);
	assert.doesNotMatch(source, /(?:vault|Vault)\.modify/);
});

test("property order is UI-only, scope-aware, and uses real rows", () => {
	assert.match(propertyOrder, /resolvePropertyOrder/);
	assert.match(propertyOrder, /most-specific|specific/i);
	assert.match(propertyOrder, /migrateFolderPropertyOrder/);
	assert.match(source, /propertyOrder/);
	assert.match(source, /scopedPropertyOrder/);
	assert.match(source, /Reorder properties/);
	assert.match(source, /setPointerCapture/);
	assert.match(source, /elementFromPoint/);
	assert.match(source, /REORDER_HANDLE_CLASS/);
	assert.match(source, /pointerdown/);
	assert.match(source, /pointermove/);
	assert.match(source, /pointerup/);
	assert.match(source, /ArrowUp/);
	assert.match(source, /ArrowDown/);
	assert.match(source, /persistDraftOrder/);
	assert.match(source, /commitReorderMode/);
	assert.match(source, /nativeRowOrder/);
	assert.match(source, /reorderSession/);
	assert.match(source, /session\.dragActive/);
	assert.match(source, /getCurrentPropertyNames\(context\)/);
	assert.match(source, /session\.draftOrder/);
	assert.match(source, /session\.entryOrder/);
	assert.match(source, /getPropertyRows\(context\.container\)/);
	assert.match(source, /if \(reorderSession\?\.active\)/);
	assert.match(source, /this\.syncToggle\(context, rowRecords\)/);
	assert.match(source, /this\.syncReorderBar\(context\)/);
	assert.match(source, /Reorder properties…/);
	assert.match(source, /menu\.addSeparator\(\);[\s\S]*Reorder properties…/);
	assert.match(source, /this\.openReorderScopeChooser\(/);
	assert.match(source, /new Menu\(\)\.setNoIcon\(\)/);
	assert.match(source, /setTitle\("This folder"\)/);
	assert.match(source, /setTitle\("This vault"\)/);
	assert.match(source, /menu\.showAtPosition\(/);
	assert.doesNotMatch(source, /console\.(log|debug|info)/);
	assert.doesNotMatch(source, /PropertyOrderScopeModal/);
	assert.doesNotMatch(source, /Choose which order to edit/);
	assert.doesNotMatch(source, /cloneNode/);
	assert.doesNotMatch(source, /(?:vault|Vault)\.modify/);
});
