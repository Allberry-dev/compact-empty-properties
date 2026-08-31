import assert from "node:assert/strict";
import test from "node:test";
import {
	getContainingFolder,
	getManualHideSequence,
	getPropertyVisibility,
	getMostSpecificFolderRule,
	getScopedRule,
	isPathWithinFolder,
	migrateFolderRulePath,
	migrateNoteRulePath,
	migrateNoteRulesUnderFolderPath,
	normalizeSettings,
	resetScopedRule,
	setVaultRule,
	resolvePropertyVisibility,
	setScopedRule,
	shouldHideProperty
} from "../src/property-visibility.ts";

test("legacy settings keep their value and default visibility to Auto", () => {
	const settings = normalizeSettings({ hideEmptyProperties: false });

	assert.equal(settings.hideEmptyProperties, false);
	assert.deepEqual(Object.keys(settings.propertyVisibility), []);
	assert.equal(getPropertyVisibility(settings.propertyVisibility, "status"), "auto");
});

test("visibility settings are normalized without accepting unknown modes", () => {
	const settings = normalizeSettings({
		hideEmptyProperties: true,
		propertyVisibility: {
			status: "show",
			topic: "hide",
			legacy: "invalid",
			ignored: 42
		}
	});

	assert.equal(getPropertyVisibility(settings.propertyVisibility, "status"), "show");
	assert.equal(getPropertyVisibility(settings.propertyVisibility, "topic"), "hide");
	assert.equal(getPropertyVisibility(settings.propertyVisibility, "legacy"), "auto");
	assert.equal(getPropertyVisibility(settings.propertyVisibility, "ignored"), "auto");
});

test("manual hide order stays bound to its direct rule scope", () => {
	let settings = normalizeSettings({
		propertyVisibility: { created: "hide" },
		manualHideOrder: { next: 18, vault: { created: 17 } }
	});
	const vaultResolution = resolvePropertyVisibility(settings, "Materials/test.md", "created");
	assert.equal(getManualHideSequence(settings, "Materials/test.md", "created", vaultResolution), 17);

	settings = setScopedRule(settings, "notes", "Materials/test.md", "created", "hide");
	const noteResolution = resolvePropertyVisibility(settings, "Materials/test.md", "created");
	assert.equal(noteResolution.source, "note");
	assert.equal(getManualHideSequence(settings, "Materials/test.md", "created", noteResolution), 18);
	assert.equal(settings.manualHideOrder.vault.created, 17);

	settings = setScopedRule(settings, "notes", "Materials/test.md", "created", "show");
	assert.equal(settings.manualHideOrder.notes["Materials/test.md"], undefined);
	assert.equal(settings.manualHideOrder.vault.created, 17);
	settings = resetScopedRule(settings, "notes", "Materials/test.md", "created");
	const inheritedResolution = resolvePropertyVisibility(settings, "Materials/test.md", "created");
	assert.equal(inheritedResolution.source, "vault");
	assert.equal(getManualHideSequence(settings, "Materials/test.md", "created", inheritedResolution), 17);

	settings = setVaultRule(settings, "created", "show");
	assert.equal(settings.manualHideOrder.vault.created, undefined);
});

test("manual hide order normalization removes entries without matching hide rules", () => {
	const settings = normalizeSettings({
		propertyVisibility: { keep: "hide", show: "show" },
		scopedPropertyVisibility: {
			notes: { "Materials/test.md": { keep: "hide", reset: "show" } },
			folders: { Materials: { folder: "hide" } }
		},
		manualHideOrder: {
			next: 2,
			vault: { keep: 4, show: 99, stale: 100 },
			notes: { "Materials/test.md": { keep: 5, reset: 6 } },
			folders: { Materials: { folder: 7, stale: 8 } }
		}
	});

	assert.deepEqual(settings.manualHideOrder, {
		next: 8,
		vault: { keep: 4 },
		notes: { "Materials/test.md": { keep: 5 } },
		folders: { Materials: { folder: 7 } }
	});
});

test("scoped Auto is normalized away and reset restores inheritance", () => {
	const settings = normalizeSettings({
		hideEmptyProperties: true,
		propertyVisibility: { status: "hide" },
		scopedPropertyVisibility: {
			notes: { "Materials/test.md": { status: "auto", topic: "show" } },
			folders: { Materials: { status: "hide", topic: "auto" } }
		}
	});

	assert.equal(getScopedRule(settings, "notes", "Materials/test.md", "status"), undefined);
	assert.equal(getScopedRule(settings, "notes", "Materials/test.md", "topic"), "show");
	assert.equal(getScopedRule(settings, "folders", "Materials", "topic"), undefined);

	const reset = resetScopedRule(settings, "notes", "Materials/test.md", "topic");
	assert.equal(getScopedRule(reset, "notes", "Materials/test.md", "topic"), undefined);
	assert.deepEqual(reset.scopedPropertyVisibility.notes, {});
});

test("Note overrides Folder, Folder overrides Vault, and Auto is the fallback", () => {
	const settings = normalizeSettings({
		propertyVisibility: { status: "hide", topic: "show" },
		scopedPropertyVisibility: {
			notes: { "Materials/Raw/test.md": { status: "show" } },
			folders: { Materials: { status: "show", topic: "hide" } }
		}
	});

	assert.deepEqual(resolvePropertyVisibility(settings, "Materials/Raw/test.md", "status"), {
		visibility: "show",
		source: "note"
	});
	assert.deepEqual(resolvePropertyVisibility(settings, "Materials/Raw/other.md", "status"), {
		visibility: "show",
		source: "folder",
		folderPath: "Materials"
	});
	assert.deepEqual(resolvePropertyVisibility(settings, "Materials/Raw/other.md", "topic"), {
		visibility: "hide",
		source: "folder",
		folderPath: "Materials"
	});
	assert.deepEqual(resolvePropertyVisibility(settings, "Other/test.md", "status"), {
		visibility: "hide",
		source: "vault"
	});
	assert.deepEqual(resolvePropertyVisibility(settings, "Other/test.md", "unknown"), {
		visibility: "auto",
		source: "auto"
	});
});

test("the most-specific folder wins and folder matching respects path boundaries", () => {
	const settings = normalizeSettings({
		scopedPropertyVisibility: {
			folders: {
				Materials: { status: "hide" },
				"Materials/Raw": { status: "show" }
			}
		}
	});

	assert.equal(isPathWithinFolder("Materials/Raw/test.md", "Materials"), true);
	assert.equal(isPathWithinFolder("Materials/Raw2/test.md", "Materials/Raw"), false);
	assert.deepEqual(getMostSpecificFolderRule(settings, "Materials/Raw/test.md", "status"), {
		folderPath: "Materials/Raw",
		visibility: "show"
	});
	assert.equal(getMostSpecificFolderRule(settings, "Materials/Raw2/test.md", "status")?.folderPath, "Materials");
});

test("root notes have no folder scope", () => {
	const settings = normalizeSettings({});
	assert.equal(getContainingFolder("test.md"), "");
	assert.equal(getScopedRule(settings, "folders", "", "status"), undefined);
	const unchanged = setScopedRule(settings, "folders", "", "status", "hide");
	assert.deepEqual(unchanged.scopedPropertyVisibility.folders, {});
});

test("Hide takes precedence over every other row state", () => {
	assert.equal(shouldHideProperty({
		visibility: "hide",
		compactEnabled: false,
		expanded: true,
		empty: false,
		editing: true,
		newlyCreated: true
	}), true);
});

test("Show takes precedence over Auto empty-property compaction", () => {
	assert.equal(shouldHideProperty({
		visibility: "show",
		compactEnabled: true,
		expanded: false,
		empty: true,
		editing: false,
		newlyCreated: false
	}), false);
});

test("Auto preserves the existing empty-property behavior", () => {
	const emptyRow = {
		visibility: "auto" as const,
		compactEnabled: true,
		expanded: false,
		empty: true,
		editing: false,
		newlyCreated: false
	};

	assert.equal(shouldHideProperty(emptyRow), true);
	assert.equal(shouldHideProperty({ ...emptyRow, expanded: true }), false);
	assert.equal(shouldHideProperty({ ...emptyRow, compactEnabled: false }), false);
	assert.equal(shouldHideProperty({ ...emptyRow, empty: false }), false);
});

test("temporary reveal overrides forced hide without changing the rule", () => {
	const forcedHide = {
		visibility: "hide" as const,
		compactEnabled: false,
		expanded: false,
		revealActive: true,
		empty: false,
		editing: false,
		newlyCreated: false
	};
	assert.equal(shouldHideProperty(forcedHide), false);
});

test("temporary reveal includes Auto empty rows and does not mutate persisted rules", () => {
	const settings = normalizeSettings({
		hideEmptyProperties: true,
		propertyVisibility: { forced: "hide" },
		scopedPropertyVisibility: {
			notes: { "Materials/test.md": { forced: "hide" } }
		}
	});
	const before = JSON.stringify(settings);
	assert.equal(shouldHideProperty({
		visibility: "auto",
		compactEnabled: true,
		expanded: false,
		revealActive: false,
		empty: true,
		editing: false,
		newlyCreated: false
	}), true);
	assert.equal(shouldHideProperty({
		visibility: "auto",
		compactEnabled: true,
		expanded: true,
		revealActive: true,
		empty: true,
		editing: false,
		newlyCreated: false
	}), false);
	assert.equal(shouldHideProperty({
		visibility: "hide",
		compactEnabled: false,
		expanded: true,
		revealActive: true,
		empty: false,
		editing: false,
		newlyCreated: false
	}), false);
	assert.equal(JSON.stringify(settings), before);
});

test("note rename migration merges destination rules without overwriting them", () => {
	const settings = normalizeSettings({
		scopedPropertyVisibility: {
			notes: {
				"Old/test.md": { status: "hide", created: "hide" },
				"New/test.md": { status: "show" }
			}
		},
		manualHideOrder: {
			next: 3,
			notes: { "Old/test.md": { status: 1, created: 2 } }
		}
	});

	const result = migrateNoteRulePath(settings, "Old/test.md", "New/test.md");
	assert.equal(result.changed, true);
	assert.deepEqual(result.settings.scopedPropertyVisibility.notes, {
		"New/test.md": { status: "show", created: "hide" }
	});
	assert.deepEqual(result.settings.manualHideOrder.notes, {
		"New/test.md": { created: 2 }
	});
});

test("folder rename migration moves descendants and preserves destination conflicts", () => {
	const settings = normalizeSettings({
		scopedPropertyVisibility: {
			folders: {
				OldFolder: { status: "hide", created: "hide" },
				"OldFolder/Sub": { topic: "hide" },
				NewFolder: { status: "show" }
			}
		},
		manualHideOrder: {
			next: 6,
			folders: {
				OldFolder: { status: 3, created: 4 },
				"OldFolder/Sub": { topic: 5 }
			}
		}
	});

	const result = migrateFolderRulePath(settings, "OldFolder", "NewFolder");
	assert.equal(result.changed, true);
	assert.deepEqual(result.settings.scopedPropertyVisibility.folders, {
		NewFolder: { status: "show", created: "hide" },
		"NewFolder/Sub": { topic: "hide" }
	});
	assert.deepEqual(result.settings.manualHideOrder.folders, {
		NewFolder: { created: 4 },
		"NewFolder/Sub": { topic: 5 }
	});
});

test("folder move migrates nested note rules and preserves destination conflicts", () => {
	const settings = normalizeSettings({
		scopedPropertyVisibility: {
			notes: {
				"OldFolder/test.md": { status: "hide", created: "hide" },
				"NewFolder/test.md": { status: "show" }
			}
		},
		manualHideOrder: {
			next: 8,
			notes: {
				"OldFolder/test.md": { status: 6, created: 7 }
			}
		}
	});

	const result = migrateNoteRulesUnderFolderPath(settings, "OldFolder", "NewFolder");
	assert.equal(result.changed, true);
	assert.deepEqual(result.settings.scopedPropertyVisibility.notes, {
		"NewFolder/test.md": { status: "show", created: "hide" }
	});
	assert.deepEqual(result.settings.manualHideOrder.notes, {
		"NewFolder/test.md": { created: 7 }
	});
});
