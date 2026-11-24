import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultTemplate } from "../core/schema.js";
import { gradeSubmission, applyManualOverrides } from "../core/grader.js";

test("gradeSubmission handles exact, alias, numericTolerance, checkbox_set, keywords, manual, and orphans", () => {
  const tpl = createDefaultTemplate();
  const key = {
    surname: { mode: "exact", maxPoints: 2, expected: "Dela Cruz", aliases: ["Cruz"] },
    age: { mode: "exact", maxPoints: 2, expected: "45", numericTolerance: 1 },
    lab_tests: {
      mode: "checkbox_set",
      maxPoints: 4,
      expected: {
        cbc: { checked: true, date: "2026-11-23", physician: "Dr. Reyes" },
        fbs: { checked: true }
      }
    },
    kar_medication: {
      mode: "keywords",
      maxPoints: 4,
      keywords: ["paracetamol", "500mg", "q6h", "prn"]
    },
    kar_special_notes: { mode: "manual", maxPoints: 5, rubricNote: "Check airway precautions" },
    nationality: { mode: "ungraded", maxPoints: 0 }
  };

  const submission = {
    answers: {
      surname: "  dela   cruz ",
      age: "46",
      lab_tests: {
        rows: [
          { id: "cbc", label: "CBC", checked: true, date: "2026-11-23", physician: "dr. reyes" },
          { id: "fbs", label: "FBS", checked: false, date: "", physician: "" },
          { id: "custom-1", label: "Urinalysis", checked: true, date: "", physician: "", isCustom: true }
        ]
      },
      kar_medication: "Give Paracetamol 500mg IV now",
      kar_special_notes: "Monitor O2 sat",
      removed_legacy_field: "Old value"
    }
  };

  const res = gradeSubmission(tpl, key, submission);
  assert.equal(res.fieldResults.surname.status, "correct");
  assert.equal(res.fieldResults.surname.autoPoints, 2);
  assert.equal(res.fieldResults.age.status, "correct");
  assert.equal(res.fieldResults.age.autoPoints, 2);
  assert.equal(res.fieldResults.lab_tests.autoPoints, 2);
  assert.equal(res.fieldResults.lab_tests.status, "needs_review");
  assert.equal(res.fieldResults.kar_medication.autoPoints, 2);
  assert.equal(res.fieldResults.kar_medication.status, "needs_review");
  assert.equal(res.fieldResults.kar_special_notes.autoPoints, 0);
  assert.equal(res.fieldResults.kar_special_notes.status, "needs_review");
  assert.deepEqual(res.orphanedKeys, ["removed_legacy_field"]);
  assert.equal(res.maxTotalScore, 17);
  assert.equal(res.autoScore, 8);
});

test("applyManualOverrides clamps points to [0, maxPoints] and recomputes finalScore", () => {
  const tpl = createDefaultTemplate();
  const base = gradeSubmission(tpl, {
    kar_special_notes: { mode: "manual", maxPoints: 5 },
    surname: { mode: "exact", maxPoints: 2, expected: "Reyes" }
  }, { answers: { surname: "Reyes", kar_special_notes: "Good" } });

  const updated = applyManualOverrides(base, {
    kar_special_notes: { overridePoints: 99, comment: "Full credit" },
    surname: { overridePoints: -3, comment: "Clamped" }
  }, { overallFeedback: "Well charted", released: true, gradedBy: "ci_ana" });

  assert.equal(updated.fieldResults.kar_special_notes.overridePoints, 5);
  assert.equal(updated.fieldResults.surname.overridePoints, 0);
  assert.equal(updated.finalScore, 5);
  assert.equal(updated.released, true);
  assert.equal(updated.gradedBy, "ci_ana");
});

test("re-grade preserves overrides (re-clamped), ignores unknown override keys, and does not mutate input", () => {
  const tpl = createDefaultTemplate();
  const key = { surname: { mode: "exact", maxPoints: 2, expected: "Reyes" } };
  const first = gradeSubmission(tpl, key, { answers: { surname: "Santos" } });
  assert.equal(first.fieldResults.surname.status, "wrong");

  const snapshot = JSON.stringify(first);
  const graded = applyManualOverrides(first, { surname: { overridePoints: 1, comment: "close" }, ghost: { overridePoints: 3 } });
  assert.equal(JSON.stringify(first), snapshot);
  assert.equal(graded.fieldResults.ghost, undefined);

  const shrunk = gradeSubmission(tpl, { surname: { mode: "exact", maxPoints: 1, expected: "Reyes" } }, { answers: { surname: "Santos" } }, { ...graded, fieldResults: { surname: { ...graded.fieldResults.surname, overridePoints: 5 } } });
  assert.equal(shrunk.fieldResults.surname.overridePoints, 1);
  assert.equal(shrunk.fieldResults.surname.comment, "close");
  assert.equal(shrunk.finalScore, 1);
});
