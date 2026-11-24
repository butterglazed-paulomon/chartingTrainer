import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import pool from "@/lib/db";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { containsExploit, sanitizeInput } from "@/lib/security";
import { ensureChartingSchema } from "./schema";
import { gradeSubmission, applyManualOverrides } from "../../core/grader.js";

type Role = "ADMIN" | "FACULTY" | "STUDENT";

export async function currentUser(): Promise<{ id: string; role: Role } | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user as { uid?: string; role?: Role } | undefined;
  return user?.uid && user.role ? { id: user.uid, role: user.role } : null;
}

const isFaculty = (role: Role) => role === "ADMIN" || role === "FACULTY";

/** Reject strings carrying exploit signatures; sanitize the rest. */
export function cleanStrings<T>(value: T): T {
  if (typeof value === "string") {
    if (containsExploit(value)) throw new Error("input rejected");
    return sanitizeInput(value) as T;
  }
  if (Array.isArray(value)) return value.map(cleanStrings) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanStrings(v)])) as T;
  }
  return value;
}

/** Students never see the answer key, and only see a grade once released. */
export function redactForStudent<T extends { answer_key_json?: unknown; grade_json?: { released?: boolean } | null }>(row: T): T {
  const { answer_key_json, ...rest } = row;
  if (!rest.grade_json?.released) return { ...rest, grade_json: null } as T;
  return rest as T;
}

export async function withClient<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  await ensureChartingSchema();
  const client = await pool.connect();
  try { return await fn(client); } finally { client.release(); }
}

export async function saveSubmission(assignmentId: string, studentId: string, answers: unknown, submit: boolean) {
  return withClient(async (client) => {
    const existing = await client.query("SELECT status FROM charting_submissions WHERE assignment_id = $1 AND student_id = $2", [assignmentId, studentId]);
    if (existing.rows[0] && existing.rows[0].status !== "draft") {
      return NextResponse.json({ error: "submission locked" }, { status: 409 });
    }
    const result = await client.query(
      `INSERT INTO charting_submissions (assignment_id, student_id, status, answers_json, submitted_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $3 = 'submitted' THEN NOW() ELSE NULL END)
       ON CONFLICT (assignment_id, student_id) DO UPDATE
         SET answers_json = $4, status = $3, submitted_at = CASE WHEN $3 = 'submitted' THEN NOW() ELSE charting_submissions.submitted_at END
       RETURNING id, status`,
      [assignmentId, studentId, submit ? "submitted" : "draft", JSON.stringify(cleanStrings(answers))]
    );
    return NextResponse.json(result.rows[0]);
  });
}

export async function gradeAndStore(submissionId: string, graderId: string, body: { overrides?: Record<string, { overridePoints?: number | null; comment?: string }>; overallFeedback?: string; released?: boolean }) {
  return withClient(async (client) => {
    const found = await client.query(
      `SELECT s.answers_json, a.answer_key_json, t.schema_json
       FROM charting_submissions s
       JOIN charting_assignments a ON a.id = s.assignment_id
       JOIN charting_templates t ON t.id = a.template_id
       WHERE s.id = $1`, [submissionId]);
    if (!found.rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
    const { answers_json, answer_key_json, schema_json } = found.rows[0];
    let grade = gradeSubmission(schema_json, answer_key_json, { answers: answers_json });
    grade = applyManualOverrides(grade, body.overrides ?? {}, { overallFeedback: body.overallFeedback, released: !!body.released, gradedBy: graderId, gradedAt: new Date().toISOString() });
    await client.query(
      `UPDATE charting_submissions SET grade_json = $2, auto_score = $3, final_score = $4, max_score = $5, status = 'graded', graded_by = $6, graded_at = NOW() WHERE id = $1`,
      [submissionId, JSON.stringify(grade), grade.autoScore, grade.finalScore, grade.maxTotalScore, graderId]);
    return NextResponse.json(grade);
  });
}

export function forbidden() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export { isFaculty };
