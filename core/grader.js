import { extractFieldIndex } from "./schema.js";

export const GRADING_MODES = Object.freeze(["ungraded", "exact", "checkbox_set", "keywords", "manual"]);

const norm = (v, cs = false) => {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  return cs ? s : s.toLowerCase();
};
const clamp = (n, max) => Math.min(Math.max(n, 0), max);
const round2 = (n) => Math.round(n * 100) / 100;
const maxOf = (rule) => (Number.isFinite(rule?.maxPoints) && rule.maxPoints > 0 ? rule.maxPoints : 0);

function gradeExact(rule, value, max) {
  const cs = !!rule.caseSensitive;
  const actual = norm(value, cs);
  const accepted = [rule.expected, ...(rule.aliases || [])];
  let ok = actual !== "" && accepted.some((e) => norm(e, cs) === actual);
  if (!ok && rule.numericTolerance != null && actual !== "") {
    const a = Number(actual);
    ok = Number.isFinite(a) && accepted.some((e) => {
      const n = Number(norm(e));
      return norm(e) !== "" && Number.isFinite(n) && Math.abs(a - n) <= rule.numericTolerance;
    });
  }
  return { autoPoints: ok ? max : 0, status: ok ? "correct" : "wrong" };
}

function gradeCheckboxSet(rule, value, max) {
  const rows = Array.isArray(value?.rows) ? value.rows : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const expected = Object.entries(rule.expected || {});
  let hit = 0;
  for (const [id, exp] of expected) {
    const row = byId.get(id);
    const checked = !!row?.checked;
    if (checked !== (exp.checked !== false)) continue;
    if (exp.date != null && norm(row?.date) !== norm(exp.date)) continue;
    if (exp.physician != null && norm(row?.physician) !== norm(exp.physician)) continue;
    hit++;
  }
  const autoPoints = expected.length ? round2((max * hit) / expected.length) : 0;
  const extra = rows.some((r) => r.checked && !(rule.expected || {})[r.id]);
  const status = extra ? "needs_review" : autoPoints === max ? "correct" : autoPoints > 0 ? "partial" : "wrong";
  return { autoPoints, status };
}

function gradeKeywords(rule, value, max) {
  const text = norm(value);
  const items = (rule.keywords || []).map((k) => (typeof k === "string" ? { term: k, weight: 1 } : { term: k.term, weight: k.weight ?? 1 }));
  const total = items.reduce((s, k) => s + k.weight, 0);
  const got = items.reduce((s, k) => (k.term && text.includes(norm(k.term)) ? s + k.weight : s), 0);
  return { autoPoints: total ? round2((max * got) / total) : 0, status: "needs_review" };
}

function gradeField(rule, value) {
  const max = maxOf(rule);
  let r;
  switch (rule.mode) {
    case "exact": r = gradeExact(rule, value, max); break;
    case "checkbox_set": r = gradeCheckboxSet(rule, value, max); break;
    case "keywords": r = gradeKeywords(rule, value, max); break;
    case "manual": r = { autoPoints: 0, status: "needs_review" }; break;
    default: r = { autoPoints: 0, status: "ungraded" };
  }
  return { mode: GRADING_MODES.includes(rule.mode) ? rule.mode : "ungraded", maxPoints: max, ...r, overridePoints: null, comment: "" };
}

function totals(grade) {
  let autoScore = 0, maxTotalScore = 0, finalScore = 0;
  for (const fr of Object.values(grade.fieldResults)) {
    maxTotalScore += fr.maxPoints;
    autoScore += fr.autoPoints;
    finalScore += fr.overridePoints ?? fr.autoPoints;
  }
  return { ...grade, autoScore: round2(autoScore), maxTotalScore: round2(maxTotalScore), finalScore: round2(finalScore) };
}

export function gradeSubmission(template, answerKey, submission, existingGrade = null) {
  const answers = submission?.answers || {};
  const fieldResults = {};
  for (const [key, rule] of Object.entries(answerKey || {})) {
    const fr = gradeField(rule || {}, answers[key]);
    const prev = existingGrade?.fieldResults?.[key];
    if (prev) {
      if (Number.isFinite(prev.overridePoints)) fr.overridePoints = clamp(prev.overridePoints, fr.maxPoints);
      fr.comment = prev.comment || "";
    }
    fieldResults[key] = fr;
  }
  const index = extractFieldIndex(template);
  const orphanedKeys = Object.keys(answers).filter((k) => !index.has(k));
  return totals({
    fieldResults,
    orphanedKeys,
    overallFeedback: existingGrade?.overallFeedback ?? "",
    released: existingGrade?.released ?? false,
    gradedBy: existingGrade?.gradedBy ?? null,
    gradedAt: existingGrade?.gradedAt ?? null,
  });
}

export function applyManualOverrides(gradeResult, overrides = {}, meta = {}) {
  const next = JSON.parse(JSON.stringify(gradeResult));
  for (const [key, o] of Object.entries(overrides || {})) {
    const fr = next.fieldResults[key];
    if (!fr || !o) continue; // unknown keys ignored
    if ("overridePoints" in o) {
      const n = o.overridePoints === null || o.overridePoints === "" ? NaN : Number(o.overridePoints);
      fr.overridePoints = Number.isFinite(n) ? clamp(n, fr.maxPoints) : null;
    }
    if (typeof o.comment === "string") fr.comment = o.comment;
  }
  for (const k of ["overallFeedback", "released", "gradedBy", "gradedAt"]) if (meta[k] !== undefined) next[k] = meta[k];
  return totals(next);
}
