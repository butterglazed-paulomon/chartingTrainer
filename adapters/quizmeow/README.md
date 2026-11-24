# Charting Trainer — quizMeow adapter

Drop-in pieces that mount the charting module inside quizMeow (Next.js App Router).
Nothing here modifies quizMeow; copy the route files below into it.

## 1. Make the core importable

From the quizMeow repo root, link this package (or copy `core/` in):

```bash
npm install /path/to/chartingTrainer
```

quizMeow's `tsconfig.json` already allows `.js` imports (`allowJs: true`).

## 2. Schema

Call `ensureChartingSchema()` from `adapters/quizmeow/schema.ts` once at startup
(or import `handlers.ts`, which calls it on every request). It uses quizMeow's
`ensureSchema` and creates `charting_templates`, `charting_assignments`,
`charting_submissions`.

## 3. API routes

Create these files under `app/api/charting/`. Each is a thin wrapper over
`adapters/quizmeow/handlers.ts`, which enforces `getServerSession` roles,
`containsExploit`/`sanitizeInput`, parameterized queries, `answer_key_json`
stripping for students, and `409` on edits after submit.

- `app/api/charting/assignments/route.ts` — `GET` published assignments for the
  student's section; faculty `POST` creates one.
- `app/api/charting/submissions/route.ts` — `POST { assignmentId, answers, submit }`
  calls `saveSubmission`.
- `app/api/charting/submissions/[id]/grade/route.ts` — faculty `POST` calls
  `gradeAndStore`.

## 4. Pages

- `app/charting/page.tsx` — student page. Load the published assignment and the
  student's submission, render `<ChartingWorkspace mode="student" ... />`.
- `app/admin/charting/page.tsx` — faculty page. Render
  `<ChartingWorkspace mode="builder" />` to edit the template and answer key,
  and `mode="grader"` to review a submission.

`ChartingWorkspace` is a client component; pass server-fetched data in as props.
