import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/main.ts"), "utf8");
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

test("the implementation keeps native add-property UI and performs no Markdown writes", () => {
	assert.match(source, /metadata-add-button/);
	assert.match(source, /insertBefore\(toggle, nativeAddButton\)/);
	assert.doesNotMatch(source, /(?:vault|Vault)\.modify/);
	assert.doesNotMatch(source, /processFrontMatter/);
	assert.doesNotMatch(source, /frontmatter.*stringify|serialize.*frontmatter/i);
});

test("disable and reload cleanup hooks are present", () => {
	assert.match(source, /onunload\(\): void/);
	assert.match(source, /controller\?\.destroy\(\)/);
	assert.match(source, /observer\.disconnect\(\)/);
	assert.match(source, /context\.toggle\?\.remove\(\)/);
	assert.match(source, /row\.classList\.remove\(HIDDEN_CLASS\)/);
});

test("theme styling uses Obsidian variables and remains lightweight", () => {
	assert.match(styles, /var\(--text-muted\)/);
	assert.match(styles, /var\(--background-modifier-hover\)/);
	assert.doesNotMatch(styles, /#[0-9a-f]{3,8}/i);
	assert.doesNotMatch(styles, /position:\s*(fixed|absolute)/);
});
