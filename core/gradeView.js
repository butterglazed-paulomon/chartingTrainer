import { cloneSchema } from "./schema.js";
import { gradeSubmission, applyManualOverrides } from "./grader.js";
import { renderStudentWorkspace } from "./renderer.js";

function make(doc, tag, props = {}, children = []) {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "className") el.className = v;
    else if (k === "text") el.textContent = String(v);
    else if (k === "value") el[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.appendChild(c);
  return el;
}

export function renderFacultyGradeView(container, options = {}) {
  const { template, assignment, submission, onSaveGrade } = options;
  const doc = options.doc ?? globalThis.document;
  let grade = options.grade ?? gradeSubmission(template, assignment?.answerKey ?? {}, submission);

  const bar = make(doc, "div", { className: "ct-gradebar ct-no-print" });
  const chart = make(doc, "div");

  const redraw = () => {
    bar.textContent = "";
    bar.appendChild(make(doc, "span", { className: "ct-score", text: `Auto ${grade.autoScore} · Final ${grade.finalScore}/${grade.maxTotalScore}` }));
    for (const [key, fr] of Object.entries(grade.fieldResults)) {
      bar.appendChild(make(doc, "span", { className: `ct-badge ${fr.status}`, text: `${key}: ${fr.status}` }));
    }
    const feedback = make(doc, "textarea", { value: grade.overallFeedback || "" });
    feedback.addEventListener("input", () => { grade.overallFeedback = feedback.value; });
    bar.appendChild(feedback);
    const mk = (text, released) => {
      const b = make(doc, "button", { type: "button", text });
      b.addEventListener("click", () => onSaveGrade?.({ ...cloneSchema(grade), released }));
      bar.appendChild(b);
    };
    mk("Save Grade", false);
    mk("Release", true);
    renderStudentWorkspace(chart, { doc, template, assignment, initialAnswers: submission?.answers, grade, readOnly: true });
  };
  redraw();

  const root = make(doc, "div", { className: "ct-root ct-gradeview" }, [bar, chart]);
  container.textContent = "";
  container.appendChild(root);

  return {
    destroy() { container.textContent = ""; },
    getGrade: () => cloneSchema(grade),
    setOverride(key, points, comment) {
      grade = applyManualOverrides(grade, { [key]: { overridePoints: points, comment } });
      redraw();
    },
  };
}
