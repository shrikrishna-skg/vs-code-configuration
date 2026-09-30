#!/usr/bin/env node
import assert from "node:assert/strict"
import { DEFAULT_PROMPT_SUGGESTIONS, MULTI_AGENT_PROMPT, PROMPT_SUGGESTIONS, patchCss, patchWebview } from "./prompt-suggestions.mjs"

const webview = [
  'var ULa=X("<div class=prompt-input-container><div class=mention-model-anchor aria-hidden=true></div><div class=prompt-input-wrapper><div></div></div><div class=prompt-input-hint><div class=prompt-input-hint-selectors></div><div class=prompt-input-hint-actions>");',
  'var ze=ULa(),Bt=ze.firstChild,Ot=Bt.nextSibling,Rn=Ot.firstChild,Jn=Rn.firstChild,Vn=Jn.nextSibling,zr=Ot.nextSibling,Oa=zr.firstChild,fo=Oa.nextSibling;ze.addEventListener("drop",ur=>{});',
].join("\n")
const css = ".prompt-input-wrapper{display:flex;gap:8px}"

const patchedWebview = patchWebview(webview)
assert.match(patchedWebview, /class=prompt-suggestion-launcher/)
assert.match(patchedWebview, /class=prompt-suggestion-menu/)
assert.match(patchedWebview, /data-prompt-suggestions-version=2/)
assert.ok(patchedWebview.includes(JSON.stringify(MULTI_AGENT_PROMPT)))
assert.ok(patchedWebview.includes(JSON.stringify(DEFAULT_PROMPT_SUGGESTIONS)))
assert.equal(PROMPT_SUGGESTIONS.multi, MULTI_AGENT_PROMPT)
assert.match(patchedWebview, /kilo\.promptSuggestions\.v2/)
assert.match(patchedWebview, /prompt-suggestion-add/)
assert.match(patchedWebview, /prompt-suggestion-drag-handle/)
assert.match(patchedWebview, /promptSuggestionsMove/)
assert.match(patchedWebview, /promptSuggestionsRemove/)
assert.match(patchedWebview, /prompt-suggestion-label-input/)
assert.match(patchedWebview, /Prompt or rule/)
assert.match(patchedWebview, /promptSuggestionsMenu\.hidden/)
assert.doesNotMatch(patchedWebview, /class=prompt-suggestion-chips/)
assert.equal(patchWebview(patchedWebview), patchedWebview, "webview patch must be idempotent")

const patchedCss = patchCss(css)
assert.match(patchedCss, /\.prompt-suggestion-launcher\{/)
assert.match(patchedCss, /\.prompt-suggestion-menu\{/)
assert.match(patchedCss, /\.prompt-suggestion-drop-before:before/)
assert.match(patchedCss, /\.prompt-suggestion-editor\{/)
assert.match(patchedCss, /:focus-visible/)
assert.equal(patchCss(patchedCss), patchedCss, "CSS patch must be idempotent")

assert.throws(() => patchWebview(webview.replace("prompt-input-hint", "other-hint")), /expected one composer template/)
assert.throws(() => patchCss(".other-wrapper{display:flex}"), /expected one prompt wrapper CSS anchor/)

console.log("prompt-suggestions patch checks passed")
