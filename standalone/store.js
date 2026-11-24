import { promises as fs } from "node:fs";
import path from "node:path";
import { createDefaultTemplate } from "../core/schema.js";

const FILES = { templates: "templates.json", assignments: "assignments.json", submissions: "submissions.json" };

function seed() {
  const template = createDefaultTemplate();
  return {
    templates: [template],
    assignments: [{
      id: "sample-case", templateId: template.id, title: "Sample Case",
      casePrompt: "A 45-year-old patient is admitted with chest pain. Complete the chart.",
      isPublished: true, answerKey: {},
    }],
    submissions: [],
  };
}

export function createJsonStore(dataDir) {
  const queues = new Map();
  const fileOf = (name) => path.join(dataDir, FILES[name]);

  async function load(name) {
    try { return JSON.parse(await fs.readFile(fileOf(name), "utf8")); }
    catch (e) { if (e.code === "ENOENT") return seed()[name]; throw e; }
  }

  // One promise chain per file: writes never interleave, so JSON can't corrupt.
  const enqueue = (name, fn) => {
    const prev = queues.get(name) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    queues.set(name, next);
    return next;
  };

  async function write(name, data) {
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = fileOf(name) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, fileOf(name));
  }

  return {
    read: load,
    update(name, mutator) {
      return enqueue(name, async () => {
        const data = await load(name);
        const result = await mutator(data);
        await write(name, data);
        return result;
      });
    },
  };
}
