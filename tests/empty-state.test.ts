import assert from "node:assert/strict";
import test from "node:test";
import {
	classifyDomValue,
	emptyRowCount,
	hiddenRowIds,
	isEmptyPropertyValue,
	toggleText
} from "../src/empty-state.ts";

test("empty scalar and structured values are hidden", () => {
	assert.equal(isEmptyPropertyValue(undefined), true);
	assert.equal(isEmptyPropertyValue(null), true);
	assert.equal(isEmptyPropertyValue(""), true);
	assert.equal(isEmptyPropertyValue([]), true);
	assert.equal(isEmptyPropertyValue({}), true);
});

test("false, zero, non-empty strings, arrays, and objects stay visible", () => {
	assert.equal(isEmptyPropertyValue(false), false);
	assert.equal(isEmptyPropertyValue(0), false);
	assert.equal(isEmptyPropertyValue("0"), false);
	assert.equal(isEmptyPropertyValue("value"), false);
	assert.equal(isEmptyPropertyValue(["bar"]), false);
	assert.equal(isEmptyPropertyValue({ key: "value" }), false);
});

test("DOM snapshots preserve false and zero", () => {
	assert.equal(classifyDomValue({ inputKind: "checkbox", checked: false }), "non-empty");
	assert.equal(classifyDomValue({ inputKind: "text", inputValue: "0" }), "non-empty");
	assert.equal(classifyDomValue({ textContent: "false" }), "non-empty");
	assert.equal(classifyDomValue({ textContent: "" }), "empty");
	assert.equal(classifyDomValue({ textContent: "{}", propertyType: "object" }), "empty");
	assert.equal(classifyDomValue({ hasChips: false, propertyType: "list" }), "empty");
	assert.equal(classifyDomValue({ hasChips: true, propertyType: "list" }), "non-empty");
});

test("ten empty rows produce the requested count and toggle labels", () => {
	const rows = Array.from({ length: 10 }, (_, index) => ({ id: `row-${index}`, value: [] }));
	assert.equal(emptyRowCount(rows), 10);
	assert.equal(hiddenRowIds(rows, true, false).length, 10);
	assert.equal(toggleText(false, 10), "显示隐藏属性 (10)");
	assert.equal(toggleText(true, 0), "隐藏属性");
});

test("toggle expansion reveals all empty rows and collapses again", () => {
	const rows = [
		{ id: "empty", value: [] },
		{ id: "false", value: false },
		{ id: "zero", value: 0 }
	];
	assert.deepEqual(hiddenRowIds(rows, true, false), ["empty"]);
	assert.deepEqual(hiddenRowIds(rows, true, true), []);
	assert.deepEqual(hiddenRowIds(rows, true, false), ["empty"]);
});

test("editing rows are protected, then hide when blur leaves them empty", () => {
	const rows = [{ id: "new", value: [], editing: true }];
	assert.deepEqual(hiddenRowIds(rows, true, false), []);
	rows[0].editing = false;
	assert.deepEqual(hiddenRowIds(rows, true, false), ["new"]);
});

test("a newly created row stays available until its first blur", () => {
	const rows = [{ id: "new", value: [], justCreated: true }];
	assert.deepEqual(hiddenRowIds(rows, true, false), []);
	rows[0].justCreated = false;
	assert.deepEqual(hiddenRowIds(rows, true, false), ["new"]);
});

test("a value entered into an empty row makes it visible", () => {
	const rows = [{ id: "topics", value: [] }];
	assert.deepEqual(hiddenRowIds(rows, true, false), ["topics"]);
	rows[0].value = ["AI"];
	assert.deepEqual(hiddenRowIds(rows, true, false), []);
});

test("switching notes is represented by fresh row input", () => {
	const noteA = [{ id: "a-empty", value: [] }];
	const noteB = [{ id: "b-value", value: "ready" }, { id: "b-empty", value: {} }];
	assert.deepEqual(hiddenRowIds(noteA, true, false), ["a-empty"]);
	assert.deepEqual(hiddenRowIds(noteB, true, false), ["b-empty"]);
});

test("disabling the setting leaves all rows visible", () => {
	const rows = [{ id: "empty", value: [] }, { id: "zero", value: 0 }];
	assert.deepEqual(hiddenRowIds(rows, false, false), []);
});
