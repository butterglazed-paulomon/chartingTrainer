import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultTemplate } from "../core/schema.js";
import { renderStudentWorkspace } from "../core/renderer.js";

// Minimal DOM stub. innerHTML assignment throws so any use fails the test.
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.listeners = {};
    this._text = "";
    this.value = "";
    const set = new Set();
    this.classList = { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), _set: set };
  }
  set className(v) { this.classList._set.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classList._set.add(c)); }
  get className() { return [...this.classList._set].join(" "); }
  set innerHTML(_) { throw new Error("innerHTML is forbidden"); }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  setAttribute(k, v) { this.attrs[k] = v; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  click() { (this.listeners.click || []).forEach((f) => f()); }
}
const doc = { createElement: (t) => new El(t) };
const walk = (el, fn) => { fn(el); el.children.forEach((c) => walk(c, fn)); };
const all = (el) => { const out = []; walk(el, (e) => out.push(e)); return out; };

test("XSS payloads in casePrompt, labels and answers stay inert text", () => {
  const payload = "<img src=x onerror=alert(1)>";
  const tpl = createDefaultTemplate();
  tpl.tabs[0].blocks[0].fields[0].label = payload;
  const container = new El("div");
  const ws = renderStudentWorkspace(container, {
    doc, template: tpl, assignment: { casePrompt: payload },
    initialAnswers: { surname: payload, [payload]: payload },
  });
  const els = all(container);
  assert.equal(els.some((e) => e.tagName === "IMG" || e.tagName === "SCRIPT"), false);
  assert.equal(els.find((e) => e.className.includes("ct-case")).textContent, payload);
  assert.equal(els.find((e) => e.attrs.name === "surname").value, payload);
  assert.ok(els.find((e) => e.tagName === "LABEL" && e.textContent === payload));
  assert.ok(els.find((e) => e.className === "ct-archived").textContent.includes(payload));
  assert.equal(ws.getAnswers().surname, payload);
});

test("custom lab row serializes with isCustom; throwing localStorage does not crash", () => {
  const storage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } };
  const container = new El("div");
  const ws = renderStudentWorkspace(container, { doc, template: createDefaultTemplate(), draftStorageKey: "k", storage });
  all(container).find((e) => e.tagName === "BUTTON" && e.textContent.includes("Add Test")).click();
  const rows = ws.getAnswers().lab_tests.rows;
  assert.equal(rows.length, 15);
  assert.equal(rows.at(-1).isCustom, true);
  assert.equal(rows[0].id, "cbc");
  ws.setAnswers({ surname: "Reyes" });
  assert.equal(ws.getAnswers().surname, "Reyes");
});

test("readOnly hides actions and disables inputs; grade feedback rendered", () => {
  const container = new El("div");
  const grade = { finalScore: 2, maxTotalScore: 2, released: true, fieldResults: { surname: { status: "correct", autoPoints: 2, maxPoints: 2, overridePoints: null, comment: "" } } };
  renderStudentWorkspace(container, { doc, template: createDefaultTemplate(), readOnly: true, grade, initialAnswers: { surname: "Reyes" } });
  const els = all(container);
  assert.equal(els.some((e) => e.className.includes("ct-actions")), false);
  assert.equal(els.find((e) => e.attrs.name === "surname").disabled, true);
  assert.ok(els.some((e) => e.className.includes("ct-fb") && e.textContent.startsWith("2/2")));
});
