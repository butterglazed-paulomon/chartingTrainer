import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultTemplate } from "../core/schema.js";
import { renderTeacherBuilder } from "../core/editor.js";
import { renderFacultyGradeView } from "../core/gradeView.js";
import { mountChartingModule } from "../core/index.js";

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
const all = (el) => { const out = []; const w = (e) => { out.push(e); e.children.forEach(w); }; w(el); return out; };
const btn = (root, text) => all(root).find((e) => e.tagName === "BUTTON" && e.textContent.includes(text));

test("builder: label rename keeps key; capture preview builds answerKey", () => {
  const container = new El("div");
  const builder = renderTeacherBuilder(container, { doc, template: createDefaultTemplate(), assignment: { title: "Case A", casePrompt: "", isPublished: false, answerKey: {} } });
  const state0 = builder.getState();
  const surname = state0.template.tabs[0].blocks.find((b) => b.fields?.some((f) => f.key === "surname")).fields.find((f) => f.key === "surname");
  assert.equal(surname.key, "surname");

  builder.renameField("surname", "Family Name");
  assert.equal(builder.getState().template.tabs[0].blocks.flatMap((b) => b.fields || []).find((f) => f.key === "surname").label, "Family Name");
  builder.setFieldKey("surname", "family_name");
  assert.ok(builder.getState().template.tabs[0].blocks.flatMap((b) => b.fields || []).some((f) => f.key === "family_name"));

  builder.addTab("Discharge");
  assert.equal(builder.getState().template.tabs.length, 4);

  builder.setPreviewAnswer("surname", "Dela Cruz");
  builder.capturePreviewAsAnswerKey();
  const key = builder.getState().assignment.answerKey;
  assert.equal(key.surname.mode, "exact");
  assert.equal(key.surname.expected, "Dela Cruz");
  builder.setPreviewLabRow("lab_tests", "cbc", { checked: true, date: "2026-11-23", physician: "Dr. Reyes" });
  builder.capturePreviewAsAnswerKey();
  assert.equal(builder.getState().assignment.answerKey.lab_tests.mode, "checkbox_set");
  assert.equal(builder.getState().assignment.answerKey.lab_tests.expected.cbc.checked, true);
});

test("grade view: badges, override + comment, onSaveGrade emits clamped released result", () => {
  const tpl = createDefaultTemplate();
  const assignment = { answerKey: { surname: { mode: "exact", maxPoints: 2, expected: "Reyes" }, kar_special_notes: { mode: "manual", maxPoints: 5 } } };
  const submission = { answers: { surname: "Reyes", kar_special_notes: "Monitor" } };
  const container = new El("div");
  let saved = null;
  const view = renderFacultyGradeView(container, { doc, template: tpl, assignment, submission, onSaveGrade: (g) => { saved = g; } });
  const els = all(container);
  assert.ok(els.some((e) => e.className.includes("ct-badge") && e.className.includes("correct")));
  assert.ok(els.some((e) => e.className.includes("ct-badge") && e.className.includes("needs_review")));
  view.setOverride("kar_special_notes", 99, "Full credit");
  view.setOverride("surname", -4, "Clamped");
  btn(container, "Release").click();
  assert.equal(saved.fieldResults.kar_special_notes.overridePoints, 5);
  assert.equal(saved.fieldResults.surname.overridePoints, 0);
  assert.equal(saved.released, true);
  assert.equal(saved.finalScore, 5);
  view.destroy();
  assert.equal(container.children.length, 0);
});

test("mountChartingModule routes modes and destroy cleans up", () => {
  for (const mode of ["student", "builder", "grader"]) {
    const container = new El("div");
    const handle = mountChartingModule(container, {
      doc, mode, template: createDefaultTemplate(),
      assignment: { answerKey: {} }, submission: { answers: {} },
    });
    assert.ok(container.children.length > 0, mode);
    handle.destroy();
    assert.equal(container.children.length, 0, mode);
  }
});
