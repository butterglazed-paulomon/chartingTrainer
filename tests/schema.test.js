import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultTemplate, validateTemplate, extractFieldIndex } from "../core/schema.js";

test("default template reproduces all 3 clinical tabs with unique stable keys", () => {
  const tpl = createDefaultTemplate();
  assert.equal(tpl.tabs.length, 3);
  assert.deepEqual(tpl.tabs.map(t => t.id), ["tab-admission", "tab-lab", "tab-kardex"]);

  const check = validateTemplate(tpl);
  assert.equal(check.valid, true, check.errors.join("; "));

  const index = extractFieldIndex(tpl);
  for (const key of ["room_bed", "phic_no", "surname", "dob", "admitting_diagnosis", "lab_last_name", "lab_tests", "kar_name", "kar_vital_signs", "kar_medication", "kar_ivf", "kar_ward"]) {
    assert.equal(index.has(key), true, `missing expected key: ${key}`);
  }

  const labBlock = tpl.tabs[1].blocks.find(b => b.type === "checkbox_table");
  assert.equal(labBlock.rows.length, 14);
  assert.equal(labBlock.allowCustomRows, true);
});

test("validateTemplate rejects duplicate field keys and invalid block types", () => {
  const bad = createDefaultTemplate();
  bad.tabs[0].blocks.push({ id: "dup", type: "row_group", fields: [{ key: "surname", label: "Dup", type: "text" }] });
  bad.tabs[0].blocks.push({ id: "badtype", type: "unknown_widget" });
  const check = validateTemplate(bad);
  assert.equal(check.valid, false);
  assert.ok(check.errors.some(e => e.includes("surname")));
  assert.ok(check.errors.some(e => e.includes("unknown_widget")));
});
