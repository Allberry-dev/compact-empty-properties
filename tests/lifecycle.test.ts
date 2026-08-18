import assert from "node:assert/strict";
import test from "node:test";
import { GenerationToken } from "../src/lifecycle.ts";

test("a note switch invalidates deferred work from the previous generation", () => {
	const token = new GenerationToken();
	const noteA = token.current();
	const noteB = token.invalidate();

	assert.equal(token.isCurrent(noteA), false);
	assert.equal(token.isCurrent(noteB), true);
});

test("rapid A to B to C switching leaves only the newest generation current", () => {
	const token = new GenerationToken();
	const noteA = token.current();
	const noteB = token.invalidate();
	const noteC = token.invalidate();

	assert.equal(token.isCurrent(noteA), false);
	assert.equal(token.isCurrent(noteB), false);
	assert.equal(token.isCurrent(noteC), true);
});
