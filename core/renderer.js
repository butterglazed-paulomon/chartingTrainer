import { extractFieldIndex } from "./schema.js";

/** Tiny DOM helper: createElement + textContent only (never innerHTML). */
function make(doc, tag, props = {}, children = []) {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "className") el.className = v;
    else if (k === "text") el.textContent = String(v);
    else if (k === "style") Object.assign(el.style, v);
    else if (k === "value" || k === "checked" || k === "disabled") el[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.appendChild(c);
  return el;
}

const clone = (o) => JSON.parse(JSON.stringify(o));

function safeStorage(opt) {
  try { return opt ?? globalThis.localStorage ?? null; } catch { return null; }
}

export function renderStudentWorkspace(container, options = {}) {
  const { template, assignment, initialAnswers, grade = null, readOnly = false, draftStorageKey, onSaveDraft, onSubmit } = options;
  const doc = options.doc ?? globalThis.document;
  const storage = draftStorageKey ? safeStorage(options.storage) : null;
  const index = extractFieldIndex(template);

  let answers = {};
  if (initialAnswers) answers = clone(initialAnswers);
  else if (storage) {
    try {
      const raw = storage.getItem(draftStorageKey);
      if (raw) answers = JSON.parse(raw) || {};
    } catch { answers = {}; }
  }

  const persist = () => {
    if (!storage) return;
    try { storage.setItem(draftStorageKey, JSON.stringify(answers)); } catch { /* quota/private mode: drafts are best effort */ }
  };
  const changed = () => { persist(); };

  const root = make(doc, "div", { className: "ct-root" });
  const tabEls = [];
  const navBtns = [];
  const setters = []; // () => void, re-sync DOM from answers

  const feedback = (key) => {
    const fr = grade?.fieldResults?.[key];
    if (!fr) return null;
    const pts = fr.overridePoints ?? fr.autoPoints;
    const el = make(doc, "div", { className: `ct-fb ${fr.status}`, text: `${pts}/${fr.maxPoints} pts` + (fr.comment ? ` — ${fr.comment}` : "") });
    return el;
  };

  function renderField(f, bare = false) {
    const id = `ct-${f.key}`;
    const label = make(doc, "label", { for: id, text: f.label });
    const common = { id, name: f.key, disabled: readOnly };
    const cur = () => (answers[f.key] ?? f.default ?? "");
    let input;
    if (f.type === "select") {
      input = make(doc, "select", common, ["", ...(f.options || [])].map((o) => make(doc, "option", { value: o, text: o })));
    } else if (f.type === "textarea") {
      input = make(doc, "textarea", { ...common, style: { height: `${f.height || 60}px` } });
    } else {
      input = make(doc, "input", { ...common, type: f.type });
    }
    const mirror = f.type === "textarea" ? make(doc, "div", { className: "ct-print-mirror" }) : null;
    const sync = () => { input.value = cur(); if (mirror) mirror.textContent = cur(); };
    sync();
    setters.push(sync);
    const onChange = () => { answers[f.key] = input.value; if (mirror) mirror.textContent = input.value; changed(); };
    input.addEventListener("input", onChange);
    input.addEventListener("change", onChange);
    const style = {};
    if (f.flex) style.flex = String(f.flex);
    if (f.minWidth) style.minWidth = `${f.minWidth}px`;
    const parts = [label, input, mirror, feedback(f.key)];
    if (bare) return parts.filter(Boolean);
    return make(doc, "div", { className: "ct-group" + (f.fullWidth ? " ct-full" : ""), style }, parts);
  }

  function renderCell(cell) {
    if (cell.cells) return make(doc, "div", { className: "ct-split" }, cell.cells.map(renderCell));
    const box = make(doc, "div", { className: "ct-box" + (cell.grow ? " ct-grow" : "") });
    for (const f of cell.fields || []) for (const n of renderField(f, true)) box.appendChild(n);
    return box;
  }

  function renderTable(block) {
    const wrap = make(doc, "div");
    const rowsState = () => (answers[block.key] ??= { rows: [] });
    const ensure = () => {
      const st = rowsState();
      const seen = new Set(st.rows.map((r) => r.id));
      for (const r of block.rows) if (!seen.has(r.id)) st.rows.push({ id: r.id, label: r.label, checked: false, date: "", physician: "" });
      return st;
    };
    ensure();
    const tbody = make(doc, "tbody");
    const draw = () => {
      tbody.textContent = "";
      ensure().rows.forEach((r) => {
        const chk = make(doc, "input", { type: "checkbox", checked: !!r.checked, disabled: readOnly });
        const date = make(doc, "input", { type: "date", value: r.date || "", disabled: readOnly });
        const phys = make(doc, "input", { type: "text", value: r.physician || "", disabled: readOnly });
        chk.addEventListener("change", () => { r.checked = !!chk.checked; changed(); });
        date.addEventListener("input", () => { r.date = date.value; changed(); });
        phys.addEventListener("input", () => { r.physician = phys.value; changed(); });
        const labelEl = make(doc, "label", {}, [chk, make(doc, "span", { text: ` ${r.label}` })]);
        tbody.appendChild(make(doc, "tr", {}, [
          make(doc, "td", { className: "ct-test" }, [labelEl]),
          make(doc, "td", {}, [date]),
          make(doc, "td", {}, [phys]),
        ]));
      });
    };
    draw();
    setters.push(draw);
    const cols = block.columns || ["Kind of Tests", "Date", "Requesting Physician"];
    const table = make(doc, "table", { className: "ct-table" }, [
      make(doc, "thead", {}, [make(doc, "tr", {}, cols.map((c) => make(doc, "th", { text: c })))]),
      tbody,
    ]);
    if (block.hint) wrap.appendChild(make(doc, "p", { className: "ct-hint ct-no-print", text: block.hint }));
    wrap.appendChild(table);
    if (block.allowCustomRows && !readOnly) {
      const add = make(doc, "button", { type: "button", className: "ct-add", text: "➕ Add Test" });
      add.addEventListener("click", () => {
        const st = ensure();
        const n = st.rows.filter((r) => r.isCustom).length + 1;
        st.rows.push({ id: `custom-${n}`, label: `Custom Test ${n}`, checked: false, date: "", physician: "", isCustom: true });
        draw();
        changed();
      });
      wrap.appendChild(add);
    }
    const fb = feedback(block.key);
    if (fb) wrap.appendChild(fb);
    return wrap;
  }

  function renderBlock(block) {
    switch (block.type) {
      case "section_header":
        return make(doc, "div", { className: block.variant === "subtitle" ? "ct-subtitle" : "ct-section-title", text: block.title });
      case "row_group": {
        const rows = block.rows || [block.fields || []];
        const frag = make(doc, "div");
        for (const r of rows) {
          frag.appendChild(make(doc, "div", { className: "ct-row" + (block.bordered ? " ct-bordered" : "") }, r.map((f) => renderField(f))));
        }
        return frag;
      }
      case "checkbox_table":
        return renderTable(block);
      case "box_grid":
        return make(doc, "div", { className: "ct-boxes", style: { gridTemplateColumns: `repeat(${block.columns || 1}, 1fr)` } },
          (block.panels || []).map((p) => make(doc, "div", { className: "ct-panel" }, p.map(renderCell))));
      default:
        return null;
    }
  }

  if (assignment?.casePrompt) root.appendChild(make(doc, "div", { className: "ct-case", text: assignment.casePrompt }));
  if (grade && grade.released !== false) {
    root.appendChild(make(doc, "div", { className: "ct-score", text: `Score: ${grade.finalScore}/${grade.maxTotalScore}` + (grade.overallFeedback ? ` — ${grade.overallFeedback}` : "") }));
  }

  const nav = make(doc, "div", { className: "ct-nav ct-no-print" });
  const show = (i) => {
    tabEls.forEach((t, j) => (j === i ? t.classList.add("active") : t.classList.remove("active")));
    navBtns.forEach((b, j) => (j === i ? b.classList.add("active") : b.classList.remove("active")));
  };
  (template.tabs || []).forEach((tab, i) => {
    const btn = make(doc, "button", { type: "button", text: tab.title || tab.id });
    btn.addEventListener("click", () => show(i));
    navBtns.push(btn);
    nav.appendChild(btn);
    const el = make(doc, "div", { className: "ct-tab", id: tab.id });
    el.appendChild(make(doc, "h2", { text: tab.heading || tab.title || tab.id }));
    for (const block of tab.blocks || []) {
      const node = renderBlock(block);
      if (node) el.appendChild(node);
    }
    tabEls.push(el);
  });
  root.appendChild(nav);
  tabEls.forEach((t) => root.appendChild(t));
  show(0);

  // Answers whose field no longer exists in the template stay visible, never silently dropped.
  const orphans = Object.keys(answers).filter((k) => !index.has(k));
  if (orphans.length) {
    const box = make(doc, "div", { className: "ct-archived" }, [make(doc, "h3", { text: "Archived Fields" })]);
    for (const k of orphans) {
      const v = typeof answers[k] === "string" ? answers[k] : JSON.stringify(answers[k]);
      box.appendChild(make(doc, "div", {}, [make(doc, "strong", { text: `${k}: ` }), make(doc, "span", { text: v })]));
    }
    root.appendChild(box);
  }

  if (!readOnly) {
    const actions = make(doc, "div", { className: "ct-actions ct-no-print" });
    const mk = (text, fn) => { const b = make(doc, "button", { type: "button", text }); b.addEventListener("click", fn); actions.appendChild(b); };
    mk("Save Draft", () => { persist(); onSaveDraft?.(clone(answers)); });
    mk("Print", () => globalThis.print?.());
    if (onSubmit) mk("Submit", () => onSubmit(clone(answers)));
    root.appendChild(actions);
  }

  container.textContent = "";
  container.appendChild(root);

  return {
    destroy() { container.textContent = ""; },
    getAnswers: () => clone(answers),
    setAnswers(next) { answers = clone(next || {}); setters.forEach((s) => s()); persist(); },
  };
}
