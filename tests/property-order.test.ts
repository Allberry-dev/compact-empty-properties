import assert from "node:assert/strict";
import test from "node:test";
import {
	getFolderOrderPaths,
	migrateFolderPropertyOrder,
	normalizePropertyOrder,
	resetFolderPropertyOrder,
	resetVaultPropertyOrder,
	resolvePropertyOrder,
	setFolderPropertyOrder,
	setVaultPropertyOrder
} from "../src/property-order.ts";
import { normalizeSettings } from "../src/property-visibility.ts";

test("legacy settings get empty Vault and Folder property order defaults", () => {
	const settings = normalizeSettings({ hideEmptyProperties: true });
	assert.deepEqual(settings.propertyOrder, []);
	assert.deepEqual(settings.scopedPropertyOrder, { folders: {} });
});

test("property order normalization keeps order, removes invalid entries, and normalizes paths", () => {
	assert.deepEqual(normalizePropertyOrder({
		propertyOrder: [" A ", "B", "A", 4, ""],
		scopedPropertyOrder: {
			folders: {
				"Materials\\Raw/": ["C", " C ", null]
			}
		}
	}), {
		propertyOrder: ["A", "B"],
		scopedPropertyOrder: { folders: { "Materials/Raw": ["C"] } }
	});
});

test("most-specific folder order wins, then parent, Vault, and native fallback", () => {
	const settings = normalizeSettings({
		propertyOrder: ["vault", "shared"],
		scopedPropertyOrder: {
			folders: {
				Materials: ["parent", "shared"],
				"Materials/Raw": ["child", "parent"]
			}
		}
	});

	assert.deepEqual(resolvePropertyOrder(
		settings,
		"Materials/Raw/test.md",
		["native", "parent", "child", "shared", "vault", "new"]
	), ["child", "parent", "shared", "vault", "native", "new"]);
	assert.deepEqual(resolvePropertyOrder(
		settings,
		"Materials/Raw2/test.md",
		["native", "parent", "child", "shared", "vault", "new"]
	), ["parent", "shared", "vault", "native", "child", "new"]);
});

test("folder paths are boundary-safe and root notes have no folder scope", () => {
	assert.deepEqual(getFolderOrderPaths("Materials/Raw/test.md"), ["Materials/Raw", "Materials"]);
	assert.deepEqual(getFolderOrderPaths("Materials/Raw2/test.md"), ["Materials/Raw2", "Materials"]);
	assert.deepEqual(getFolderOrderPaths("test.md"), []);
});

test("saving order is explicit, immutable, and preserves stale entries", () => {
	const settings = normalizeSettings({
		propertyOrder: ["A", "stale"],
		scopedPropertyOrder: { folders: { Materials: ["A", "old"] } }
	});
	const vault = setVaultPropertyOrder(settings, ["B", "A"]);
	const folder = setFolderPropertyOrder(settings, "Materials", ["B", "A"]);

	assert.deepEqual(vault.propertyOrder, ["B", "A", "stale"]);
	assert.deepEqual(folder.scopedPropertyOrder.folders, { Materials: ["B", "A", "old"] });
	assert.deepEqual(settings.propertyOrder, ["A", "stale"]);
	assert.deepEqual(settings.scopedPropertyOrder.folders, { Materials: ["A", "old"] });

	assert.deepEqual(resetVaultPropertyOrder(vault).propertyOrder, []);
	assert.deepEqual(resetFolderPropertyOrder(folder, "Materials").scopedPropertyOrder.folders, {});
});

test("folder rename migration merges destination order without overwriting it", () => {
	const settings = normalizeSettings({
		propertyOrder: ["vault"],
		scopedPropertyOrder: {
			folders: {
				OldFolder: ["status", "created"],
				"OldFolder/Sub": ["topic"],
				NewFolder: ["status", "destination"]
			}
		}
	});

	const result = migrateFolderPropertyOrder(settings, "OldFolder", "NewFolder");
	assert.equal(result.changed, true);
	assert.deepEqual(result.settings.scopedPropertyOrder.folders, {
		NewFolder: ["status", "destination", "created"],
		"NewFolder/Sub": ["topic"]
	});
	assert.deepEqual(settings.scopedPropertyOrder.folders.OldFolder, ["status", "created"]);
});
