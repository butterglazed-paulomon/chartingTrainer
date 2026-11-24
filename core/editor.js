import { cloneSchema, extractFieldIndex, validateTemplate } from "./schema.js";
import { renderStudentWorkspace } from "./renderer.js";

const clone = cloneSchema;

function make(doc, tag, props = {}, children = []) {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "className") el.className = v;
    else if (k === "text") el.textContent = String(v);
    else if (k === "value" || k === "checked") el[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.appendChild(c);
  return el;
}

const findField = (template, key) => {
  for (const tab of template.tabs) for (const block of tab.blocks) {
    for (const f of block.fields || []) if (f.key === key) return f;
    for (const row of block.rows || []) for (const f of row) if (f.key === key) return f;
    for (const panel of block.panels || []) for (const cell of panel) for (const f of cell.fields || []) if (f.key === key) return f;
  }
  return null;
};

export function renderTeacherBuilder(container, options = {}) {
  const doc = options.doc ?? globalThis.document;
  const state = {
    template: clone(options.template),
    assignment: clone(options.assignment ?? { title: "", casePrompt: "", isPublished: false, answerKey: {} }),
    previewAnswers: {},
  };

  const previewHost = make(doc, "div", { className: "ct-preview" });
  const inspector = make(doc, "div", { className: "ct-inspector" });

  const redraw = () => {
    const check = validateTemplate(state.template);
    inspector.textContent = "";
    const fields = [...extractFieldIndex(state.template).entries()];
    inspector.appendChild(make(doc, "p", { text: `${state.template.tabs.length} tabs, ${fields.length} fields` + (check.valid ? "" : ` — ${check.errors[0]}`) }));
    for (const [key, meta] of fields) {
      inspector.appendChild(make(doc, "div", { className: "ct-field-row" }, [
        make(doc, "span", { text: `${meta.label} (${key})` }),
      ]));
    }
    renderStudentWorkspace(previewHost, { doc, template: state.template, assignment: state.assignment, initialAnswers: state.previewAnswers });
  };
  redraw();

  const root = make(doc, "div", { className: "ct-root ct-builder" }, [inspector, previewHost]);
  container.textContent = "";
  container.appendChild(root);

  return {
    destroy() { container.textContent = ""; },
    getState: () => clone(state),
    renameField(key, label) { const f = findField(state.template, key); if (f) { f.label = label; redraw(); } },
    setFieldKey(oldKey, newKey) {
      const f = findField(state.template, oldKey);
      if (!f || !newKey || newKey === oldKey) return;
      f.key = newKey;
      if (state.assignment.answerKey[oldKey]) { state.assignment.answerKey[newKey] = state.assignment.answerKey[oldKey]; delete state.assignment.answerKey[oldKey]; }
      redraw();
    },
    addTab(title) {
      const id = `tab-${String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      state.template.tabs.push({ id, title, heading: title, blocks: [] });
      redraw();
    },
    setPreviewAnswer(key, value) { state.previewAnswers[key] = value; },
    setPreviewLabRow(blockKey, rowId, patch) {
      const rows = (state.previewAnswers[blockKey] ??= { rows: [] }).rows;
      const row = rows.find((r) => r.id === rowId) ?? rows[rows.push({ id: rowId, label: rowId, checked: false, date: "", physician: "" }) - 1];
      Object.assign(row, patch);
    },
    capturePreviewAsAnswerKey() {
      const key = {};
      for (const [k, v] of Object.entries(state.previewAnswers)) {
        if (v && typeof v === "object" && Array.isArray(v.rows)) {
          const expected = {};
          for (const r of v.rows) if (r.checked) expected[r.id] = { checked: true, date: r.date || undefined, physician: r.physician || undefined };
          if (Object.keys(expected).length) key[k] = { mode: "checkbox_set", maxPoints: 1, expected };
        } else if (String(v ?? "").trim()) {
          key[k] = { mode: "exact", maxPoints: 1, expected: String(v).trim() };
        }
      }
      state.assignment.answerKey = key;
      redraw();
    },
  };
}
