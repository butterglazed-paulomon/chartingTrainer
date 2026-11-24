export { BLOCK_TYPES, FIELD_TYPES, createDefaultTemplate, validateTemplate, extractFieldIndex, cloneSchema } from "./schema.js";
export { GRADING_MODES, gradeSubmission, applyManualOverrides } from "./grader.js";
export { renderStudentWorkspace } from "./renderer.js";
export { renderTeacherBuilder } from "./editor.js";
export { renderFacultyGradeView } from "./gradeView.js";

import { renderStudentWorkspace } from "./renderer.js";
import { renderTeacherBuilder } from "./editor.js";
import { renderFacultyGradeView } from "./gradeView.js";

/** Single entry point for hosts (standalone page, quizMeow, others). */
export function mountChartingModule(container, config = {}) {
  const mode = config.mode ?? "student";
  if (mode === "builder") return renderTeacherBuilder(container, config);
  if (mode === "grader") return renderFacultyGradeView(container, config);
  return renderStudentWorkspace(container, config);
}
