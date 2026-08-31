import assert from "node:assert/strict";
import test from "node:test";
import {
	getPropertyIcon,
	mergePropertyIconNames,
	normalizePropertyIcons,
	resetPropertyIcon,
	setPropertyIcon
} from "../src/property-icons.ts";
import {
	normalizeSettings,
	setScopedRule,
	setVaultRule
} from "../src/property-visibility.ts";

test("property icon settings normalize to non-empty icon IDs", () => {
	assert.deepEqual(normalizePropertyIcons({
		" focus ": " target ",
		created: "",
		removed: null,
		legacy: "auto",
		invalid: 42,
		unknown: "not-a-registered-icon"
	}), {
		focus: "target",
		unknown: "not-a-registered-icon"
	});
});

test("property icon settings remain backward compatible", () => {
	const settings = normalizeSettings({ hideEmptyProperties: false });

	assert.equal(settings.hideEmptyProperties, false);
	assert.deepEqual(settings.propertyIcons, {});
});

test("property icon changes and reset are immutable and reset removes the entry", () => {
	const original = { focus: "target", created: "calendar" };
	const changed = setPropertyIcon(original, "source_url", "link");
	const reset = resetPropertyIcon(changed, "focus");

	assert.deepEqual(original, { focus: "target", created: "calendar" });
	assert.deepEqual(changed, {
		focus: "target",
		created: "calendar",
		source_url: "link"
	});
	assert.deepEqual(reset, { created: "calendar", source_url: "link" });
	assert.equal(getPropertyIcon(reset, "focus"), undefined);
});

test("property icon names include current Vault properties and stale configured names", () => {
	assert.deepEqual(mergePropertyIconNames(
		["status", "created", "status"],
		["source_url", "created"]
	), ["created", "source_url", "status"]);
});

test("visibility changes preserve the independent property icon map", () => {
	let settings = normalizeSettings({ propertyIcons: { focus: "target" } });
	settings = setVaultRule(settings, "status", "hide");
	settings = setScopedRule(settings, "notes", "Materials/test.md", "status", "show");

	assert.deepEqual(settings.propertyIcons, { focus: "target" });
});
