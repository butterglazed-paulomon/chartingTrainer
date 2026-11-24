import { ensureSchema } from "@/lib/ensureSchema";

export const CHARTING_DDL = `
  CREATE TABLE IF NOT EXISTS charting_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    schema_json JSONB NOT NULL,
    created_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS charting_assignments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id    UUID NOT NULL REFERENCES charting_templates(id) ON DELETE CASCADE,
    course_code    VARCHAR(50),
    section        VARCHAR(50),
    title          TEXT NOT NULL,
    case_prompt    TEXT NOT NULL DEFAULT '',
    answer_key_json JSONB NOT NULL DEFAULT '{}',
    is_published   BOOLEAN NOT NULL DEFAULT false,
    created_by     UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS charting_submissions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES charting_assignments(id) ON DELETE CASCADE,
    student_id    UUID NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'draft',
    answers_json  JSONB NOT NULL DEFAULT '{}',
    grade_json    JSONB,
    auto_score    NUMERIC,
    final_score   NUMERIC,
    max_score     NUMERIC,
    submitted_at  TIMESTAMPTZ,
    graded_by     UUID,
    graded_at     TIMESTAMPTZ,
    UNIQUE (assignment_id, student_id)
  );`;

export const ensureChartingSchema = () => ensureSchema("charting_v1", CHARTING_DDL);
