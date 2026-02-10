#!/usr/bin/env tsx
/**
 * Pit Scouting Form Generator
 *
 * Generates TypeScript/React code from JSON schemas
 * Usage: npm run generate-pit-form -- --year 2026
 */

import * as fs from "fs";
import * as path from "path";
import type { PitScoutingSchema, SchemaSection, SchemaField } from "../lib/config";

const MARKER_START = "/* GENERATED:";
const MARKER_END = "/* GENERATED:END */";

interface GeneratedCode {
  types: string;
  state: string;
  formJsx: string;
  displayJsx: string;
  restoration: string;
  saveData: string;
}

/**
 * Main generator function
 */
async function generatePitForm(year: string) {
  console.log(`\n🔧 Generating pit scouting form for year ${year}...\n`);

  // Load schema
  const schemaPath = path.join(
    process.cwd(),
    `lib/config/pit-scouting-schemas/${year}.json`
  );

  if (!fs.existsSync(schemaPath)) {
    console.error(`❌ Schema not found: ${schemaPath}`);
    process.exit(1);
  }

  const schema: PitScoutingSchema = JSON.parse(
    fs.readFileSync(schemaPath, "utf-8")
  );

  console.log(`✓ Loaded schema: ${schema.year} ${schema.game}`);
  console.log(`  - Sections: ${schema.customSections.length}`);

  // Generate code
  const code = generateCode(schema);

  // Update files
  updatePitScoutFormContext(code.types);
  updatePitScoutPage(code);
  updateTeamInfoPage(code.displayJsx);

  console.log("\n✅ Generation complete!");
  console.log("\nGenerated code in:");
  console.log("  - lib/context/PitScoutFormContext.tsx");
  console.log("  - apps/mobile/src/routes/pitscout.tsx");
  console.log("  - apps/mobile/src/routes/team-info.tsx");
  console.log("\n💡 Run 'git diff' to review changes");
}

/**
 * Generate all code sections
 */
function generateCode(schema: PitScoutingSchema): GeneratedCode {
  const sections = schema.customSections;

  return {
    types: generateTypeDefinitions(sections),
    state: generateStateDeclarations(sections),
    formJsx: generateFormJsx(sections),
    displayJsx: generateDisplayJsx(sections),
    restoration: generateRestorationLogic(sections),
    saveData: generateSaveData(sections),
  };
}

/**
 * Generate TypeScript interface
 */
function generateTypeDefinitions(sections: SchemaSection[]): string {
  const lines: string[] = [];

  for (const section of sections) {
    lines.push(`  ${section.id}: {`);

    for (const field of section.fields) {
      const optional = field.optional || field.type === "text" ? "?" : "";
      let type: string;

      switch (field.type) {
        case "boolean":
          type = "boolean";
          break;
        case "text":
          type = "string";
          break;
        case "select":
          type = "string | null";
          break;
        default:
          type = "any";
      }

      lines.push(`    ${field.name}${optional}: ${type};`);
    }

    lines.push(`  };`);
  }

  return lines.join("\n");
}

/**
 * Generate React state declarations
 */
function generateStateDeclarations(sections: SchemaSection[]): string {
  const lines: string[] = [];

  for (const section of sections) {
    lines.push(`  // ${section.title} state`);

    for (const field of section.fields) {
      const varName = `${section.id}${capitalize(field.name)}`;
      const setterName = `set${capitalize(section.id)}${capitalize(field.name)}`;

      let defaultValue: string;
      switch (field.type) {
        case "boolean":
          defaultValue = "false";
          break;
        case "text":
          defaultValue = '""';
          break;
        case "select":
          // If "None" is an option, default to "None", otherwise null
          defaultValue = field.options?.includes("None") ? '"None"' : "null";
          break;
        default:
          defaultValue = "null";
      }

      lines.push(`  const [${varName}, ${setterName}] = useState${field.type === "boolean" ? "" : field.type === "text" ? "<string>" : "<string | null>"}(${defaultValue});`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate form JSX sections
 */
function generateFormJsx(sections: SchemaSection[]): string {
  const sectionComponents: string[] = [];

  for (const section of sections) {
    const fields = generateFormFields(section);

    sectionComponents.push(`
        {/* ${section.title} Section */}
        <Section title="${section.title}">
${fields}
        </Section>`);
  }

  return sectionComponents.join("\n");
}

/**
 * Generate form fields for a section with smart grid layout
 * - Even number of fields: 2 per row
 * - Odd number of fields: 2 per row, last one full width
 */
function generateFormFields(section: SchemaSection): string {
  const mainFields = section.fields.filter((f) => !f.conditional);
  const conditionalFields = section.fields.filter((f) => f.conditional);

  let jsx = '          <div className="flex flex-col gap-3 px-2">\n';

  // Generate main fields with smart layout
  if (mainFields.length > 0) {
    jsx += generateSmartGridLayout(section.id, mainFields);
  }

  // Generate conditional fields with smart layout
  if (conditionalFields.length > 0) {
    jsx += generateConditionalFields(section.id, conditionalFields);
  }

  jsx += "          </div>";

  return jsx;
}

/**
 * Generate smart grid layout for fields
 * Even count: all in grid-cols-2
 * Odd count: all but last in grid-cols-2, last one full width
 */
function generateSmartGridLayout(sectionId: string, fields: SchemaField[]): string {
  let jsx = "";

  if (fields.length === 0) return jsx;

  // Special case: 4 select options (like climb levels) should be grid-cols-4
  if (fields.length === 1 && fields[0].type === "select" && fields[0].options && fields[0].options.length === 4) {
    jsx += '            <div className="grid grid-cols-4 gap-3">\n';
    jsx += generateFieldJsx(sectionId, fields[0], "              ");
    jsx += "            </div>\n";
    return jsx;
  }

  const isEven = fields.length % 2 === 0;

  if (isEven) {
    // All fields go in grid-cols-2
    jsx += '            <div className="grid grid-cols-2 gap-3">\n';
    for (const field of fields) {
      jsx += generateFieldJsx(sectionId, field, "              ");
    }
    jsx += "            </div>\n";
  } else {
    // All but last in grid-cols-2
    const allButLast = fields.slice(0, -1);
    const lastField = fields[fields.length - 1];

    if (allButLast.length > 0) {
      jsx += '            <div className="grid grid-cols-2 gap-3">\n';
      for (const field of allButLast) {
        jsx += generateFieldJsx(sectionId, field, "              ");
      }
      jsx += "            </div>\n";
    }

    // Last field full width
    jsx += generateFieldJsx(sectionId, lastField, "            ");
  }

  return jsx;
}

/**
 * Generate conditional fields with proper layout
 */
function generateConditionalFields(sectionId: string, fields: SchemaField[]): string {
  let jsx = "";

  // Group conditional fields by their condition
  const fieldsByCondition: Map<string, SchemaField[]> = new Map();

  for (const field of fields) {
    if (!field.conditional) continue;

    const conditionKey = `${field.conditional.field}:${field.conditional.equals !== undefined ? field.conditional.equals : `!${field.conditional.notEquals}`}`;

    if (!fieldsByCondition.has(conditionKey)) {
      fieldsByCondition.set(conditionKey, []);
    }
    fieldsByCondition.get(conditionKey)!.push(field);
  }

  // Generate each conditional group with smart layout
  for (const [conditionKey, condFields] of fieldsByCondition.entries()) {
    const firstField = condFields[0];
    if (!firstField.conditional) continue;

    const conditionVar = `${firstField.conditional.field.split(".").map((p, i) => i === 0 ? p : capitalize(p)).join("")}`;
    const operator = firstField.conditional.notEquals !== undefined ? "!==" : "===";
    const value = firstField.conditional.notEquals !== undefined
      ? JSON.stringify(firstField.conditional.notEquals)
      : JSON.stringify(firstField.conditional.equals);

    jsx += `            {${conditionVar} ${operator} ${value} && (\n`;

    // Smart layout for conditional fields
    const isEven = condFields.length % 2 === 0;

    if (condFields.length === 1) {
      // Single field, full width
      jsx += generateFieldJsx(sectionId, condFields[0], "              ");
    } else if (isEven) {
      // Even number: all in grid-cols-2
      jsx += '              <div className="grid grid-cols-2 gap-3">\n';
      for (const field of condFields) {
        jsx += generateFieldJsx(sectionId, field, "                ");
      }
      jsx += "              </div>\n";
    } else {
      // Odd number: all but last in grid-cols-2, last full width
      // Wrap in fragment to avoid adjacent JSX elements error
      const allButLast = condFields.slice(0, -1);
      const lastField = condFields[condFields.length - 1];

      jsx += "              <>\n";
      jsx += '                <div className="grid grid-cols-2 gap-3">\n';
      for (const field of allButLast) {
        jsx += generateFieldJsx(sectionId, field, "                  ");
      }
      jsx += "                </div>\n";
      jsx += generateFieldJsx(sectionId, lastField, "                ");
      jsx += "              </>\n";
    }

    jsx += "            )}\n";
  }

  return jsx;
}

/**
 * Generate JSX for a single field
 */
function generateFieldJsx(sectionId: string, field: SchemaField, indent: string): string {
  const varName = `${sectionId}${capitalize(field.name)}`;
  const setterName = `set${capitalize(sectionId)}${capitalize(field.name)}`;
  const info = field.info ? `\n${indent}  info="${field.info}"` : "";

  switch (field.type) {
    case "boolean":
      return `${indent}<ScoutToggle
${indent}  pressed={${varName}}
${indent}  onPressedChange={${setterName}}
${indent}  className="w-full"${info}
${indent}>
${indent}  ${field.label}
${indent}</ScoutToggle>\n`;

    case "text":
      return `${indent}<Input
${indent}  value={${varName}}
${indent}  onChange={(e) => ${setterName}(e.target.value)}
${indent}  className="h-10 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground"
${indent}  placeholder="${field.label}"
${indent}/>\n`;

    case "select":
      // Generate toggle buttons for select options
      const options = field.options || [];
      let selectJsx = "";
      for (const option of options) {
        selectJsx += `${indent}<ScoutToggle
${indent}  pressed={${varName} === "${option}"}
${indent}  onPressedChange={(p) => ${setterName}(p ? "${option}" : null)}
${indent}  className="w-full"
${indent}>
${indent}  ${option}
${indent}</ScoutToggle>\n`;
      }
      return selectJsx;

    default:
      return "";
  }
}

/**
 * Generate display JSX sections
 */
function generateDisplayJsx(sections: SchemaSection[]): string {
  const sectionComponents: string[] = [];

  for (const section of sections) {
    sectionComponents.push(`
              {/* ${section.title} Section */}
              <div>
                <p className="text-base text-primary font-semibold mb-3">
                  ${section.title.toUpperCase()}
                </p>
                <div className="rounded-2xl bg-muted px-6 py-4">
${generateDisplayFields(section)}
                </div>
              </div>`);
  }

  return sectionComponents.join("\n");
}

/**
 * Generate display fields for a section
 */
function generateDisplayFields(section: SchemaSection): string {
  const lines: string[] = [];
  const booleanFields = section.fields.filter((f) => f.type === "boolean" && !f.conditional);
  const textFields = section.fields.filter((f) => f.type === "text");
  const selectFields = section.fields.filter((f) => f.type === "select");

  // Boolean fields (Yes/No display)
  for (let i = 0; i < booleanFields.length; i++) {
    const field = booleanFields[i];

    lines.push(`                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">${field.label}</p>
                    <p
                      className={\`font-semibold \${pitData.${section.id}?.${field.name} ? "text-chart-2" : "text-destructive"}\`}
                    >
                      {pitData.${section.id}?.${field.name} ? "Yes" : "No"}
                    </p>
                  </div>`);

    if (i < booleanFields.length - 1 || textFields.length > 0 || selectFields.length > 0) {
      lines.push(`                  <div className="h-px bg-border my-2" />`);
    }
  }

  // Text fields (show value if exists)
  if (textFields.length > 0) {
    lines.push(`                  {(${textFields.map(f => `pitData.${section.id}?.${f.name}`).join(" || ")}) && (
                    <>
                      <div className="h-px bg-border my-2" />
                      <div className="grid grid-cols-2 gap-4 py-2">`);

    for (const field of textFields) {
      lines.push(`                        {pitData.${section.id}?.${field.name} && (
                          <div>
                            <p className="text-foreground text-sm mb-1">${field.label}</p>
                            <p className="font-semibold text-foreground">
                              {pitData.${section.id}.${field.name}}
                            </p>
                          </div>
                        )}`);
    }

    lines.push(`                      </div>
                    </>
                  )}`);
  }

  // Select fields
  for (const field of selectFields) {
    lines.push(`                  <div className="flex items-center justify-between py-2">
                    <p className="text-foreground">${field.label}</p>
                    <p className="font-semibold text-foreground">
                      {pitData.${section.id}?.${field.name} || "None"}
                    </p>
                  </div>`);
  }

  return lines.join("\n");
}

/**
 * Generate form restoration logic
 */
function generateRestorationLogic(sections: SchemaSection[]): string {
  const lines: string[] = [];

  for (const section of sections) {
    for (const field of section.fields) {
      const varName = `${section.id}${capitalize(field.name)}`;
      const setterName = `set${capitalize(section.id)}${capitalize(field.name)}`;
      const defaultValue = field.type === "text" ? ' || ""' : "";

      lines.push(`      ${setterName}(formData.${section.id}.${field.name}${defaultValue});`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate save data object
 */
function generateSaveData(sections: SchemaSection[]): string {
  const lines: string[] = [];

  for (const section of sections) {
    lines.push(`      ${section.id}: {`);

    for (const field of section.fields) {
      const varName = `${section.id}${capitalize(field.name)}`;
      lines.push(`        ${field.name}: ${varName},`);
    }

    lines.push(`      },`);
  }

  return lines.join("\n");
}

/**
 * Update PitScoutFormContext.tsx with generated types
 */
function updatePitScoutFormContext(types: string) {
  const filePath = path.join(
    process.cwd(),
    "lib/context/PitScoutFormContext.tsx"
  );

  let content = fs.readFileSync(filePath, "utf-8");

  // Replace between markers
  const startMarker = `${MARKER_START}TYPES:START */`;
  const endMarker = MARKER_END;

  content = replaceSection(content, startMarker, endMarker, types);

  fs.writeFileSync(filePath, content);
  console.log("✓ Updated PitScoutFormContext.tsx");
}

/**
 * Update pitscout.tsx with generated code
 */
function updatePitScoutPage(code: GeneratedCode) {
  const filePath = path.join(
    process.cwd(),
    "apps/mobile/src/routes/pitscout.tsx"
  );

  let content = fs.readFileSync(filePath, "utf-8");

  // Replace state declarations
  content = replaceSection(
    content,
    `${MARKER_START}STATE:START */`,
    MARKER_END,
    code.state
  );

  // Replace form JSX
  content = replaceSection(
    content,
    `{${MARKER_START}FORM:START */}`,
    MARKER_END,
    code.formJsx
  );

  // Replace restoration logic
  content = replaceSection(
    content,
    `${MARKER_START}RESTORE:START */`,
    MARKER_END,
    code.restoration
  );

  // Replace save data
  content = replaceSection(
    content,
    `${MARKER_START}SAVE:START */`,
    MARKER_END,
    code.saveData
  );

  fs.writeFileSync(filePath, content);
  console.log("✓ Updated pitscout.tsx");
}

/**
 * Update team-info.tsx with generated display code
 */
function updateTeamInfoPage(displayJsx: string) {
  const filePath = path.join(
    process.cwd(),
    "apps/mobile/src/routes/team-info.tsx"
  );

  let content = fs.readFileSync(filePath, "utf-8");

  // Replace display JSX
  content = replaceSection(
    content,
    `{${MARKER_START}DISPLAY:START */}`,
    MARKER_END,
    displayJsx
  );

  fs.writeFileSync(filePath, content);
  console.log("✓ Updated team-info.tsx");
}

/**
 * Replace section between markers
 */
function replaceSection(
  content: string,
  startMarker: string,
  endMarker: string,
  newContent: string
): string {
  // Determine if this is a JSX context based on marker type
  const isJsxMarker = startMarker.includes("FORM:") || startMarker.includes("DISPLAY:");

  // For JSX markers, we need to look for the JSX comment format
  const actualEndMarker = isJsxMarker ? `{${endMarker}}` : endMarker;

  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(actualEndMarker, startIndex);

  if (startIndex === -1 || endIndex === -1) {
    console.warn(`⚠️  Markers not found: ${startMarker} or ${actualEndMarker}`);
    return content;
  }

  const before = content.substring(0, startIndex + startMarker.length);
  const after = content.substring(endIndex);

  // Determine proper spacing based on marker type
  const spacing = isJsxMarker ? "        " : "    ";

  return `${before}\n${newContent}\n${spacing}${after}`;
}

/**
 * Capitalize first letter
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * CLI entry point
 */
const args = process.argv.slice(2);
const yearIndex = args.indexOf("--year");
const year = yearIndex !== -1 ? args[yearIndex + 1] : "2026";

generatePitForm(year);
