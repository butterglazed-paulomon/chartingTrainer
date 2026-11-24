export const BLOCK_TYPES = Object.freeze(["section_header", "row_group", "checkbox_table", "box_grid"]);
export const FIELD_TYPES = Object.freeze(["text", "number", "date", "time", "datetime-local", "select", "textarea"]);

export const cloneSchema = (obj) => JSON.parse(JSON.stringify(obj));

// A box_grid cell is { fields: [...] } (a bordered box) or { cells: [...] } (side-by-side boxes).
function cellFields(cell) {
  if (!cell) return [];
  if (Array.isArray(cell.cells)) return cell.cells.flatMap(cellFields);
  return cell.fields || [];
}

/** All leaf fields of a block (excludes checkbox_table, which is keyed by the block itself). */
export function blockFields(block) {
  if (block.type === "row_group") return block.rows ? block.rows.flat() : block.fields || [];
  if (block.type === "box_grid") return (block.panels || []).flat().flatMap(cellFields);
  return [];
}

function* walk(template) {
  for (const tab of template?.tabs || []) {
    for (const block of tab.blocks || []) {
      if (block.type === "checkbox_table") {
        yield { key: block.key, tabId: tab.id, blockType: block.type, label: block.title || block.key, fieldType: "checkbox_table" };
      }
      for (const f of blockFields(block)) {
        yield { key: f.key, tabId: tab.id, blockType: block.type, label: f.label, fieldType: f.type };
      }
    }
  }
}

export function extractFieldIndex(template) {
  const index = new Map();
  for (const { key, ...meta } of walk(template)) if (!index.has(key)) index.set(key, meta);
  return index;
}

export function validateTemplate(template) {
  const errors = [];
  if (!template || typeof template !== "object" || !Array.isArray(template.tabs)) {
    return { valid: false, errors: ["template.tabs must be an array"] };
  }
  const tabIds = new Set();
  const keys = new Set();
  const checkKey = (key, where) => {
    if (typeof key !== "string" || !key.trim()) errors.push(`${where}: empty or missing key`);
    else if (keys.has(key)) errors.push(`duplicate key: ${key}`);
    else keys.add(key);
  };
  for (const tab of template.tabs) {
    if (!tab?.id || typeof tab.id !== "string") errors.push("tab missing id");
    else if (tabIds.has(tab.id)) errors.push(`duplicate tab id: ${tab.id}`);
    else tabIds.add(tab.id);
    for (const block of tab?.blocks || []) {
      if (!BLOCK_TYPES.includes(block?.type)) {
        errors.push(`invalid block type: ${block?.type}`);
        continue;
      }
      if (block.type === "checkbox_table") checkKey(block.key, `checkbox_table ${block.id}`);
      for (const f of blockFields(block)) {
        if (!FIELD_TYPES.includes(f.type)) errors.push(`invalid field type for ${f.key}: ${f.type}`);
        checkKey(f.key, `field "${f.label}"`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

// ---- default clinical template (mirrors the original index.html) ----
const f = (key, label, type = "text", extra = {}) => ({ key, label, type, ...extra });
const row = (id, ...fields) => ({ id, type: "row_group", fields });
const header = (id, title) => ({ id, type: "section_header", title });
const box = (key, label, height, extra = {}) => ({ fields: [f(key, label, "textarea", { height, ...extra })] });

const LAB_TESTS = ["CBC", "HGT", "BUN", "BUA", "CREA", "LIPID PROFILE", "ALT", "AST", "TOTAL CHOLESTEROL", "TRIGLYCERIDES", "NA", "K", "CALCIUM", "FBS"];

export function createDefaultTemplate() {
  const admission = {
    id: "tab-admission",
    title: "Admission & Discharge",
    heading: "Admission and Discharge Record",
    blocks: [
      row("adm-room", f("room_bed", "Room and Bed No."), f("phic_no", "PHIC No.")),
      header("adm-h-patient", "PATIENT INFORMATION"),
      row("adm-name", f("surname", "Surname"), f("first_name", "First Name"), f("middle_name", "Middle Name")),
      row("adm-perm", f("perm_house", "Permanent Address (House Number)", "text", { flex: 2 }), f("perm_brgy", "Barangay"), f("perm_city", "Municipality/City"), f("perm_province", "Province"), f("perm_zip", "Zip Code", "text", { minWidth: 80 })),
      row("adm-prov", f("prov_house", "Provincial Address (House Number)", "text", { flex: 2 }), f("prov_brgy", "Barangay"), f("prov_city", "Municipality/City"), f("prov_province", "Province"), f("prov_zip", "Zip Code", "text", { minWidth: 80 })),
      row("adm-demo",
        f("age", "Age", "number", { minWidth: 80 }),
        f("sex", "Sex", "select", { options: ["Male", "Female"] }),
        f("civil_status", "Civil Status", "select", { options: ["Single", "Married", "Widower/Widow", "Separated"] }),
        f("nationality", "Nationality", "text", { default: "Filipino" }),
        f("religion", "Religion")),
      row("adm-birth", f("dob", "Date of Birth", "date"), f("pob", "Place of Birth")),
      header("adm-h-emp", "EMPLOYMENT DETAILS"),
      row("adm-emp1", f("occupation", "Occupation"), f("employer", "Present Employer")),
      row("adm-emp2", f("employer_address", "Employer's Address", "text", { flex: 2 }), f("employer_contact", "Landline/Mobile Number")),
      header("adm-h-contacts", "CONTACTS & RELATIVES"),
      row("adm-rel1", f("nearest_relative", "Name of Nearest Relative"), f("relative_relationship", "Relationship"), f("relative_contact", "Landline/Mobile Number")),
      row("adm-rel2", f("relative_address", "Address", "text", { fullWidth: true })),
      row("adm-spouse", f("spouse_name", "Name of Spouse"), f("spouse_contact", "Landline/Mobile Number"), f("spouse_occupation", "Occupation")),
      header("adm-h-hosp", "HOSPITALIZATION DETAILS"),
      row("adm-hosp1",
        f("admission_date", "Admission Date", "date"), f("admission_time", "Time", "time"),
        f("discharge_date", "Discharge Date", "date"), f("discharge_time", "Time", "time"),
        f("total_days", "Total Number of days", "number", { minWidth: 80 })),
      row("adm-hosp2", f("type_of_admission", "Type of Admission"), f("hosp_attending_physician", "Attending Physician/s")),
      header("adm-h-informant", "INFORMANT"),
      row("adm-informant", f("informant_first", "First Name"), f("informant_middle", "Middle Name"), f("informant_surname", "Surname")),
      header("adm-h-dx", "DIAGNOSIS & PERSONNEL"),
      row("adm-dx1", f("admitting_diagnosis", "Admitting Diagnosis", "text", { fullWidth: true })),
      row("adm-dx2", f("final_diagnosis", "Final Diagnosis", "text", { fullWidth: true })),
      row("adm-staff", f("admitting_physician", "Admitting Physician/ROD"), f("admitting_nurse", "Admitting Nurse")),
    ],
  };

  const lab = {
    id: "tab-lab",
    title: "Laboratory Request",
    heading: "Laboratory Request Record",
    blocks: [
      header("lab-h-patient", "PATIENT INFORMATION"),
      row("lab-name", f("lab_last_name", "Last Name"), f("lab_first_name", "First Name"), f("lab_middle_name", "Middle Name")),
      row("lab-addr", f("lab_street", "Street #", "text", { flex: 2 }), f("lab_brgy", "Barangay"), f("lab_city", "City/Municipality")),
      header("lab-h-tests", "LABORATORY TESTS"),
      {
        id: "lab-tests",
        type: "checkbox_table",
        key: "lab_tests",
        title: "Laboratory Tests",
        hint: 'Check the requested tests and fill in the corresponding date and requesting physician. Use the "+ Add Test" button for unlisted tests.',
        columns: ["Kind of Tests", "Date", "Requesting Physician"],
        rows: LAB_TESTS.map((label) => ({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label })),
        allowCustomRows: true,
      },
    ],
  };

  const kardex = {
    id: "tab-kardex",
    title: "Kardex",
    heading: "Kardex",
    blocks: [
      { id: "kar-sub", type: "section_header", variant: "subtitle", title: "PHILHEALTH ACCREDITED" },
      {
        id: "kar-demo",
        type: "row_group",
        bordered: true,
        rows: [
          [f("kar_name", "NAME", "text", { flex: 3 }), f("kar_age", "AGE", "number"), f("kar_gender", "GENDER")],
          [f("kar_address", "ADDRESS", "text", { flex: 3 }), f("kar_birthdate", "BIRTHDATE", "date")],
          [f("kar_admission", "DATE/TIME OF ADMISSION", "datetime-local"), f("kar_hospital_no", "HOSPITAL No.")],
          [f("kar_cc", "CHIEF COMPLAINT", "text", { flex: 2 }), f("kar_phic", "PHILHEALTH No.")],
          [f("kar_diagnosis", "DIAGNOSIS", "text", { flex: 2 }), f("kar_physician", "ATTENDING PHYSICIAN", "text", { flex: 2 })],
        ],
      },
      {
        id: "kar-grid",
        type: "box_grid",
        columns: 2,
        panels: [
          [
            box("kar_vital_signs", "VITAL SIGNS", 80),
            { grow: true, ...box("kar_medication", "MEDICATION", 200) },
            box("kar_special_notes", "SPECIAL NOTES/ENDORSEMENT", 100),
          ],
          [
            {
              fields: [
                f("kar_ivf", "IVF", "textarea", { height: 40 }),
                f("kar_side_drip", "SIDE DRIP:", "textarea", { height: 40 }),
                f("kar_ivf_to_follow", "IVF TO FOLLOW:", "textarea", { height: 40 }),
              ],
            },
            box("kar_laboratory", "LABORATORY", 50),
            box("kar_diagnostic", "DIAGNOSTIC PROCEDURE", 50),
            { cells: [box("kar_contraption", "CONTRAPTION", 50), box("kar_diet", "DIET", 50)] },
          ],
        ],
      },
      {
        id: "kar-footer",
        type: "row_group",
        bordered: true,
        fields: [f("kar_ward", "WARD"), f("kar_room", "ROOM"), f("kar_nurse", "NURSE ON DUTY", "text", { flex: 2 })],
      },
    ],
  };

  return { id: "default-clinical", version: 1, title: "Clinical Charting", tabs: [admission, lab, kardex] };
}
