// The JSON Schema half of the runner protocol check (docs/spec/engine/runners.md#drift-check).
//
// A strict evaluator for the JSON Schema 2020-12 subset the runner schema is written in, and the checks
// that keep that schema well formed. Strict matters: a keyword this evaluator did not know would be
// ignored, so a vector could pass while a real validator refused it. `schemaProblems` refuses any
// keyword outside `KEYWORDS`, which keeps "the schema accepts this vector" and "this checker accepts
// this vector" the same statement.

const DRAFT = "https://json-schema.org/draft/2020-12/schema";
const TYPES = new Set(["object", "array", "string", "integer", "number", "boolean", "null"]);

/** Every keyword the evaluator understands. Annotations (`title`, `description`, `contentEncoding`) never reject. */
export const KEYWORDS = new Set([
  "$schema", "$id", "$ref", "$defs", "title", "description", "contentEncoding",
  "type", "const", "enum", "minLength", "pattern", "minimum", "exclusiveMinimum", "maximum",
  "oneOf", "items", "prefixItems", "minItems", "maxItems", "required", "properties", "additionalProperties",
]);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** The `$defs` name a local reference points at, or null for anything else. */
export function refName(ref) {
  return typeof ref === "string" && ref.startsWith("#/$defs/") ? ref.slice("#/$defs/".length) : null;
}

/** Errors for `value` against `current` (default the whole schema); an empty array means valid. */
export function schemaErrors(root, value, current = root, path = "$") {
  const errors = [];
  if (current.$ref !== undefined) {
    const name = refName(current.$ref);
    const target = name === null ? undefined : root.$defs?.[name];
    if (target === undefined) return [`${path}: unresolved $ref ${String(current.$ref)}`];
    errors.push(...schemaErrors(root, value, target, path));
  }
  if (typeof current.type === "string") {
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const wanted = current.type === "integer" ? "number" : current.type;
    if (actual !== wanted || (current.type === "integer" && !Number.isInteger(value))) {
      errors.push(`${path}: expected ${current.type}, got ${actual}`);
    }
  }
  if (current.const !== undefined && !same(current.const, value)) errors.push(`${path}: const mismatch`);
  if (Array.isArray(current.enum) && !current.enum.some((option) => same(option, value))) errors.push(`${path}: not in enum`);
  if (typeof value === "string") {
    if (typeof current.minLength === "number" && value.length < current.minLength) errors.push(`${path}: too short`);
    if (typeof current.pattern === "string" && !new RegExp(current.pattern).test(value)) errors.push(`${path}: pattern mismatch`);
  }
  if (typeof value === "number") {
    if (typeof current.minimum === "number" && value < current.minimum) errors.push(`${path}: below minimum`);
    if (typeof current.exclusiveMinimum === "number" && value <= current.exclusiveMinimum) errors.push(`${path}: at or below exclusive minimum`);
    if (typeof current.maximum === "number" && value > current.maximum) errors.push(`${path}: above maximum`);
  }
  if (Array.isArray(current.oneOf)) {
    const matches = current.oneOf.filter((candidate) => schemaErrors(root, value, candidate, path).length === 0).length;
    if (matches !== 1) errors.push(`${path}: oneOf matched ${matches}`);
  }
  if (Array.isArray(value)) {
    if (typeof current.minItems === "number" && value.length < current.minItems) errors.push(`${path}: too few items`);
    if (typeof current.maxItems === "number" && value.length > current.maxItems) errors.push(`${path}: too many items`);
    const prefix = Array.isArray(current.prefixItems) ? current.prefixItems : [];
    prefix.forEach((child, index) => {
      if (index < value.length) errors.push(...schemaErrors(root, value[index], child, `${path}[${index}]`));
    });
    if (isObject(current.items)) {
      value.slice(prefix.length).forEach((item, index) =>
        errors.push(...schemaErrors(root, item, current.items, `${path}[${index + prefix.length}]`)));
    }
  }
  if (isObject(value)) {
    for (const key of current.required ?? []) if (!hasOwn(value, key)) errors.push(`${path}: missing ${key}`);
    const properties = current.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      if (hasOwn(properties, key)) errors.push(...schemaErrors(root, child, properties[key], `${path}.${key}`));
      else if (current.additionalProperties === false) errors.push(`${path}: extra ${key}`);
      else if (isObject(current.additionalProperties)) errors.push(...schemaErrors(root, child, current.additionalProperties, `${path}.${key}`));
    }
  }
  return errors;
}

/** The inline sub-schemas of one node (not `$defs`), each with the label that names where it sits. */
function children(node) {
  const out = [];
  for (const [name, property] of Object.entries(node.properties ?? {})) out.push([`properties.${name}`, property]);
  if (isObject(node.items)) out.push(["items", node.items]);
  if (isObject(node.additionalProperties)) out.push(["additionalProperties", node.additionalProperties]);
  (Array.isArray(node.prefixItems) ? node.prefixItems : []).forEach((item, index) => out.push([`prefixItems[${index}]`, item]));
  (Array.isArray(node.oneOf) ? node.oneOf : []).forEach((alternative, index) => out.push([`oneOf[${index}]`, alternative]));
  return out;
}

/** Problems that make the schema itself unfit to be the contract. Empty when well formed. */
export function schemaProblems(schema) {
  const problems = [];
  if (schema.$schema !== DRAFT) problems.push(`schema: $schema must be ${DRAFT}`);
  if (typeof schema.$id !== "string" || !/^https:\/\/tk-reawakened\.dev\/schema\/runner-protocol-v[12]\.schema\.json$/.test(schema.$id)) {
    problems.push("schema: $id must name a supported runner-protocol schema version");
  }
  if (!isObject(schema.$defs)) return [...problems, "schema: $defs is missing"];

  const referenced = new Set();
  const visit = (node, label) => {
    if (!isObject(node)) {
      problems.push(`schema ${label}: a schema must be an object`);
      return;
    }
    for (const keyword of Object.keys(node)) {
      if (!KEYWORDS.has(keyword)) problems.push(`schema ${label}: keyword "${keyword}" is not one this check evaluates`);
    }
    if (node.$ref !== undefined) {
      const name = refName(node.$ref);
      if (name === null || !hasOwn(schema.$defs, name)) problems.push(`schema ${label}: unresolved $ref ${String(node.$ref)}`);
      else referenced.add(name);
    }
    if (node.type !== undefined && !TYPES.has(node.type)) problems.push(`schema ${label}: unknown type ${JSON.stringify(node.type)}`);
    if (node.enum !== undefined && !(Array.isArray(node.enum) && node.enum.length > 0)) problems.push(`schema ${label}: enum must be a non-empty array`);
    if (node.oneOf !== undefined && !(Array.isArray(node.oneOf) && node.oneOf.length > 0)) problems.push(`schema ${label}: oneOf must be a non-empty array`);
    if (node.prefixItems !== undefined && !(Array.isArray(node.prefixItems) && node.prefixItems.length > 0)) problems.push(`schema ${label}: prefixItems must be a non-empty array`);
    for (const keyword of ["minItems", "maxItems"]) {
      if (node[keyword] !== undefined && (!Number.isInteger(node[keyword]) || node[keyword] < 0)) problems.push(`schema ${label}: ${keyword} must be a non-negative integer`);
    }
    if (node.properties !== undefined) {
      // AD-14: a record has exactly its keys, so an object that declares keys is closed.
      if (node.additionalProperties !== false) problems.push(`schema ${label}: an object with properties must set additionalProperties: false`);
      for (const key of node.required ?? []) {
        if (!hasOwn(node.properties, key)) problems.push(`schema ${label}: required key "${key}" is not a declared property`);
      }
    } else if (node.required !== undefined) {
      problems.push(`schema ${label}: required without properties`);
    }
    for (const [name, child] of children(node)) visit(child, `${label}.${name}`);
  };
  visit(schema, "$");
  for (const [name, definition] of Object.entries(schema.$defs)) visit(definition, `$defs.${name}`);

  // Reachability: a definition nothing points at describes nothing a runner receives, so it is drift.
  const reachable = new Set();
  const walk = (node) => {
    for (const name of refsOf(node)) {
      if (reachable.has(name) || !hasOwn(schema.$defs, name)) continue;
      reachable.add(name);
      walk(schema.$defs[name]);
    }
  };
  walk(schema);
  for (const name of Object.keys(schema.$defs)) {
    if (!reachable.has(name)) problems.push(`schema $defs.${name}: unreachable from the root; delete it or reference it`);
  }
  return problems;
}

/** Every `$defs` name a node refers to, however deep, without following the references. */
function refsOf(node, out = new Set()) {
  if (!isObject(node)) return out;
  const name = refName(node.$ref);
  if (name !== null) out.add(name);
  for (const [, child] of children(node)) refsOf(child, out);
  return out;
}
