import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJsonStore } from "../standalone/store.js";
import { createChartingServer } from "../standalone/server.js";

const PIN = "246810";
let base, dir;

let server;
test.before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ct-"));
  server = createChartingServer({ dataDir: dir, facultyPin: PIN, secret: "test-secret" });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await rm(dir, { recursive: true, force: true }); });

const call = (p, { method = "GET", body, cookie } = {}) => fetch(base + p, {
  method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const cookieOf = (res) => res.headers.get("set-cookie").split(";")[0];

test("student flow: login, answerKey stripped, draft then 409 after submit, unreleased grade hidden", async () => {
  const bad = await call("/api/templates");
  assert.equal(bad.status, 401);

  const login = await call("/api/login", { method: "POST", body: { role: "student", studentId: "2024-001", studentName: "Ana" } });
  assert.equal(login.status, 200);
  const cookie = cookieOf(login);

  const assignments = await (await call("/api/assignments", { cookie })).json();
  assert.equal(assignments.length, 1);
  assert.equal("answerKey" in assignments[0], false);

  const draft = await call("/api/submissions", { method: "POST", cookie, body: { assignmentId: "sample-case", answers: { surname: "Reyes" }, submit: false } });
  assert.equal(draft.status, 200);
  const again = await call("/api/submissions", { method: "POST", cookie, body: { assignmentId: "sample-case", answers: { surname: "Santos" }, submit: true } });
  assert.equal(again.status, 200);
  const locked = await call("/api/submissions", { method: "POST", cookie, body: { assignmentId: "sample-case", answers: { surname: "Hack" }, submit: false } });
  assert.equal(locked.status, 409);

  const mine = await (await call("/api/submissions", { cookie })).json();
  assert.equal(mine.length, 1);
  assert.equal(mine[0].grade, null);
});

test("faculty PIN: wrong rejected, right accepted; grading + release visible to student", async () => {
  const wrong = await call("/api/login", { method: "POST", body: { role: "faculty", pin: "000000" } });
  assert.equal(wrong.status, 401);
  const ok = await call("/api/login", { method: "POST", body: { role: "faculty", pin: PIN } });
  assert.equal(ok.status, 200);
  const cookie = cookieOf(ok);

  const assignments = await (await call("/api/assignments", { cookie })).json();
  assert.equal("answerKey" in assignments[0], true);

  const subs = await (await call("/api/submissions", { cookie })).json();
  const graded = await call(`/api/submissions/${subs[0].id}/grade`, { method: "POST", cookie, body: { overrides: {}, overallFeedback: "ok", released: true } });
  assert.equal(graded.status, 200);

  const student = cookieOf(await call("/api/login", { method: "POST", body: { role: "student", studentId: "2024-001" } }));
  const mine = await (await call("/api/submissions", { cookie: student })).json();
  assert.equal(mine[0].grade.released, true);
  assert.equal(mine[0].grade.overallFeedback, "ok");

  const other = cookieOf(await call("/api/login", { method: "POST", body: { role: "student", studentId: "2024-999" } }));
  const theirs = await (await call(`/api/submissions/${subs[0].id}`, { cookie: other })).status;
  assert.equal(theirs, 403);
});

test("tampered session cookie is rejected", async () => {
  const res = await call("/api/login", { method: "POST", body: { role: "student", studentId: "x" } });
  const [name, token] = cookieOf(res).split("=");
  const flipped = token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A");
  const denied = await call("/api/templates", { cookie: `${name}=${flipped}` });
  assert.equal(denied.status, 401);
});

test("CSV neutralizes formula injection; concurrent store writes all survive", async () => {
  const cookie = cookieOf(await call("/api/login", { method: "POST", body: { role: "faculty", pin: PIN } }));
  const a = await (await call("/api/assignments", { method: "POST", cookie, body: { templateId: "default-clinical", title: "CSV Case", answerKey: {} } })).json();
  for (const [id, feedback] of [["=cmd|'/C calc'!A0", "fine"], ["2024-002", "+SUM(A1)"]]) {
    const s = await (await call("/api/submissions", { method: "POST", cookie, body: { assignmentId: a.id, studentId: id, answers: {}, submit: true } })).json();
    await call(`/api/submissions/${s.id}/grade`, { method: "POST", cookie, body: { overrides: {}, overallFeedback: feedback, released: true } });
  }
  const csv = await (await call(`/api/assignments/${a.id}/export.csv`, { cookie })).text();
  assert.match(csv, /^'=cmd\|'\/C calc'!A0,/m);
  assert.match(csv, /,'\+SUM\(A1\)$/m);

  const store = createJsonStore(dir);
  await Promise.all([1, 2, 3, 4, 5].map((n) => store.update("templates", (list) => { list.push({ id: `t-${n}`, tabs: [] }); })));
  const templates = await store.read("templates");
  for (const n of [1, 2, 3, 4, 5]) assert.ok(templates.some((t) => t.id === `t-${n}`));
});
