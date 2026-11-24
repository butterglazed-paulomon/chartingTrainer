import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJsonStore } from "./store.js";
import { createAuth } from "./auth.js";
import { validateTemplate } from "../core/schema.js";
import { gradeSubmission, applyManualOverrides } from "../core/grader.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const csvCell = (v) => {
  const s = String(v ?? "");
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

const readBody = (req) => new Promise((resolve, reject) => {
  let data = "";
  req.on("data", (c) => { data += c; if (data.length > 2_000_000) reject(new Error("too big")); });
  req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("bad json")); } });
  req.on("error", reject);
});

const stripKey = (a) => { const { answerKey, ...rest } = a; return rest; };

export function createChartingServer({ dataDir, facultyPin, secret }) {
  const store = createJsonStore(dataDir);
  const auth = createAuth({ facultyPin, secret });

  const json = (res, code, body, headers = {}) => {
    res.writeHead(code, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    const session = auth.sessionFrom(req);
    const faculty = session?.role === "faculty";
    try {
      if (req.method === "POST" && p === "/api/login") {
        const body = await readBody(req);
        if (body.role === "faculty") {
          if (!auth.checkPin(body.pin)) return json(res, 401, { error: "invalid pin" });
          return json(res, 200, { role: "faculty" }, { "set-cookie": auth.cookieHeader("faculty") });
        }
        if (!body.studentId || typeof body.studentId !== "string") return json(res, 400, { error: "studentId required" });
        return json(res, 200, { role: "student", studentId: body.studentId }, { "set-cookie": auth.cookieHeader("student", body.studentId, body.studentName ?? "") });
      }
      if (!session) return json(res, 401, { error: "unauthenticated" });

      if (p === "/api/templates" && req.method === "GET") return json(res, 200, await store.read("templates"));
      if (p === "/api/templates" && req.method === "POST") {
        if (!faculty) return json(res, 403, { error: "faculty only" });
        const body = await readBody(req);
        const check = validateTemplate(body);
        if (!check.valid) return json(res, 400, { error: check.errors.join("; ") });
        return json(res, 201, await store.update("templates", (list) => { list.push(body); return body; }));
      }
      const tplId = p.match(/^\/api\/templates\/([^/]+)$/);
      if (tplId && req.method === "PUT") {
        if (!faculty) return json(res, 403, { error: "faculty only" });
        const body = await readBody(req);
        const check = validateTemplate(body);
        if (!check.valid) return json(res, 400, { error: check.errors.join("; ") });
        const saved = await store.update("templates", (list) => {
          const i = list.findIndex((t) => t.id === tplId[1]);
          if (i < 0) return null;
          list[i] = { ...body, id: tplId[1] };
          return list[i];
        });
        return saved ? json(res, 200, saved) : json(res, 404, { error: "not found" });
      }

      if (p === "/api/assignments" && req.method === "GET") {
        const list = await store.read("assignments");
        return json(res, 200, faculty ? list : list.filter((a) => a.isPublished).map(stripKey));
      }
      if (p === "/api/assignments" && req.method === "POST") {
        if (!faculty) return json(res, 403, { error: "faculty only" });
        const body = await readBody(req);
        const a = { id: `a-${Date.now()}`, templateId: body.templateId, title: body.title ?? "", casePrompt: body.casePrompt ?? "", isPublished: !!body.isPublished, answerKey: body.answerKey ?? {} };
        return json(res, 201, await store.update("assignments", (list) => { list.push(a); return a; }));
      }
      const asgId = p.match(/^\/api\/assignments\/([^/]+)$/);
      if (asgId && req.method === "PUT") {
        if (!faculty) return json(res, 403, { error: "faculty only" });
        const body = await readBody(req);
        const saved = await store.update("assignments", (list) => {
          const i = list.findIndex((a) => a.id === asgId[1]);
          if (i < 0) return null;
          list[i] = { ...list[i], ...body, id: asgId[1] };
          return list[i];
        });
        return saved ? json(res, 200, saved) : json(res, 404, { error: "not found" });
      }

      if (p === "/api/submissions" && req.method === "GET") {
        const list = await store.read("submissions");
        const visible = faculty ? list : list.filter((s) => s.studentId === session.studentId);
        return json(res, 200, visible.map((s) => (faculty || s.grade?.released ? s : { ...s, grade: null })));
      }
      if (p === "/api/submissions" && req.method === "POST") {
        const body = await readBody(req);
        const studentId = faculty ? body.studentId : session.studentId;
        const saved = await store.update("submissions", (list) => {
          let s = list.find((x) => x.assignmentId === body.assignmentId && x.studentId === studentId);
          if (s && (s.status === "submitted" || s.status === "graded")) return { conflict: true };
          if (!s) { s = { id: `s-${Date.now()}`, assignmentId: body.assignmentId, studentId, status: "draft", answers: {}, grade: null }; list.push(s); }
          s.answers = body.answers ?? {};
          if (body.submit) { s.status = "submitted"; s.submittedAt = new Date().toISOString(); }
          return s;
        });
        return saved.conflict ? json(res, 409, { error: "submission locked" }) : json(res, 200, saved);
      }
      const subId = p.match(/^\/api\/submissions\/([^/]+)$/);
      if (subId && req.method === "GET") {
        const s = (await store.read("submissions")).find((x) => x.id === subId[1]);
        if (!s) return json(res, 404, { error: "not found" });
        if (!faculty && s.studentId !== session.studentId) return json(res, 403, { error: "not yours" });
        return json(res, 200, faculty || s.grade?.released ? s : { ...s, grade: null });
      }
      const gradePath = p.match(/^\/api\/submissions\/([^/]+)\/grade$/);
      if (gradePath && req.method === "POST") {
        if (!faculty) return json(res, 403, { error: "faculty only" });
        const body = await readBody(req);
        const saved = await store.update("submissions", async (list) => {
          const s = list.find((x) => x.id === gradePath[1]);
          if (!s) return null;
          const assignment = (await store.read("assignments")).find((a) => a.id === s.assignmentId);
          const template = (await store.read("templates")).find((t) => t.id === assignment?.templateId);
          let grade = gradeSubmission(template ?? { tabs: [] }, assignment?.answerKey ?? {}, s, s.grade);
          if (body.overrides) grade = applyManualOverrides(grade, body.overrides, { overallFeedback: body.overallFeedback, released: !!body.released, gradedBy: "faculty", gradedAt: new Date().toISOString() });
          s.grade = grade;
          s.status = "graded";
          return s;
        });
        return saved ? json(res, 200, saved) : json(res, 404, { error: "not found" });
      }

      const csvPath = p.match(/^\/api\/assignments\/([^/]+)\/export\.csv$/);
      if (csvPath && req.method === "GET") {
        if (!faculty) return json(res, 403, { error: "faculty only" });
        const subs = (await store.read("submissions")).filter((s) => s.assignmentId === csvPath[1]);
        const lines = ["studentId,status,finalScore,maxTotalScore,feedback"];
        for (const s of subs) lines.push([s.studentId, s.status, s.grade?.finalScore ?? "", s.grade?.maxTotalScore ?? "", s.grade?.overallFeedback ?? ""].map(csvCell).join(","));
        res.writeHead(200, { "content-type": "text/csv" });
        return res.end(lines.join("\n"));
      }

      if (req.method === "GET" && !p.startsWith("/api/")) {
        const file = p === "/" ? "index.html" : path.basename(p);
        const allowed = new Map([["index.html", "text/html"], ["styles.css", "text/css"], ["index.js", "text/javascript"]]);
        if (!allowed.has(file)) return json(res, 404, { error: "not found" });
        const dir = file === "index.html" ? path.join(ROOT, "public") : path.join(ROOT, "..", "core");
        const content = await readFile(path.join(dir, file), "utf8");
        res.writeHead(200, { "content-type": allowed.get(file) });
        return res.end(content);
      }
      return json(res, 404, { error: "not found" });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  });

  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const pin = process.env.CHARTING_FACULTY_PIN ?? String(Math.floor(100000 + Math.random() * 900000));
  if (!process.env.CHARTING_FACULTY_PIN) console.log(`Faculty PIN (set CHARTING_FACULTY_PIN to override): ${pin}`);
  const secret = process.env.CHARTING_SECRET ?? createAuth({ facultyPin: pin, secret: "x" }).newSecret();
  const server = createChartingServer({ dataDir: path.join(ROOT, "data"), facultyPin: pin, secret });
  server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? "127.0.0.1");
}
