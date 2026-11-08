// The TypeScript half of the runner protocol check (docs/spec/engine/runners.md#drift-check).
//
// Reads the wire types straight from `packages/core/src/ports/` with the TypeScript compiler and
// compares each, recursively and without running any code, with its definition in the JSON schema.
// The two sides are compared in the JSON projection a non-TypeScript runner sees: every key present,
// `null` for absence, a `Uint8Array` leaf as a base64 string.
//
// What is compared: object keys, which are required, literal and enum values, `null`, arrays, records
// and nested objects. What is not: schema-only refinements (`minimum`, `pattern`, `minLength`),
// because TypeScript has no integer or bounded type; the refusal vectors hold those.

import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { refName } from "./schema.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PORTS = "packages/core/src/ports";

/** The three record families on the boundary: where each TypeScript type lives and the schema `$defs` that describes it. */
export const ROOTS = [
  { file: `${PORTS}/draw.ts`, alias: "DrawList", def: "drawList" },
  { file: `${PORTS}/input.ts`, alias: "InputRecordV1", def: "inputRecord" },
  { file: `${PORTS}/requests.ts`, alias: "RunnerRequest", def: "request" },
];

/** A `Uint8Array` leaf reached through these definitions is an untagged string (the schema's own `plainData` note). */
const UNTAGGED_BYTES = new Set(["plainData"]);

const cache = new Map();

/**
 * Build one program over the three port files. `sources` maps a repository-relative path to a function
 * that rewrites that file's text, so a test can perturb a type without touching the working tree.
 */
function createProgram(sources, roots) {
  const config = ts.getParsedCommandLineOfConfigFile(
    join(repo, "packages/core/tsconfig.json"),
    { noEmit: true, composite: false },
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (diagnostic) => { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")); } },
  );
  const host = ts.createCompilerHost(config.options, true);
  host.getSourceFile = (fileName, languageVersion) => {
    const original = host.readFile(fileName);
    if (original === undefined) return undefined;
    const rewrite = sources[relative(repo, fileName).split(sep).join("/")];
    const text = rewrite === undefined ? original : rewrite(original);
    const hit = cache.get(fileName);
    if (hit !== undefined && hit.text === text) return hit.file;
    const file = ts.createSourceFile(fileName, text, languageVersion, true);
    cache.set(fileName, { text, file });
    return file;
  };
  return ts.createProgram(roots.map((root) => join(repo, root.file)), config.options, host);
}

/** Problems between the wire types in `core` and `schema`; empty when they describe the same records. */
export function typeProblems(schema, { sources = {}, inputAlias = "InputRecordV1" } = {}) {
  const problems = [];
  const defs = schema.$defs ?? {};
  const roots = ROOTS.map((root) => root.def === "inputRecord" ? { ...root, alias: inputAlias } : root);
  const rootRefs = (schema.oneOf ?? []).map((alternative) => refName(alternative.$ref)).sort();
  const wanted = roots.map((root) => root.def).sort();
  if (JSON.stringify(rootRefs) !== JSON.stringify(wanted)) {
    problems.push(`schema root: oneOf must reference exactly ${wanted.join(", ")}; it references ${rootRefs.join(", ") || "nothing"}`);
  }

  const program = createProgram(sources, roots);
  const checker = program.getTypeChecker();
  const typeIds = new Map();
  const nodeIds = new Map();
  const onStack = new Set();
  const id = (table, object) => {
    if (!table.has(object)) table.set(object, table.size);
    return table.get(object);
  };

  /** What a TypeScript type is, one entry per union member, in the JSON projection. */
  function members(type) {
    const out = [];
    let sawTrue = false;
    let sawFalse = false;
    for (const part of type.isUnion() ? type.types : [type]) {
      const flags = part.flags;
      if (flags & ts.TypeFlags.Undefined) continue; // an optional key's `undefined` is spelt by `required`
      if (flags & ts.TypeFlags.BooleanLiteral) {
        if (checker.typeToString(part) === "true") sawTrue = true;
        else sawFalse = true;
      } else if (flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral)) out.push({ k: "literal", value: part.value });
      else if (flags & ts.TypeFlags.String) out.push({ k: "string" });
      else if (flags & ts.TypeFlags.Number) out.push({ k: "number" });
      else if (flags & ts.TypeFlags.Boolean) out.push({ k: "boolean" });
      else if (flags & ts.TypeFlags.Null) out.push({ k: "null" });
      else if (flags & ts.TypeFlags.Intersection) {
        // A branded primitive (`string & { brand }`) is the primitive on the wire.
        const primitive = part.types.find((member) => member.flags & (ts.TypeFlags.String | ts.TypeFlags.Number));
        out.push(primitive === undefined ? { k: "unsupported", text: checker.typeToString(part) } : { k: primitive.flags & ts.TypeFlags.String ? "string" : "number" });
      } else if (flags & ts.TypeFlags.Object) {
        const infos = checker.getIndexInfosOfType(part);
        const properties = checker.getPropertiesOfType(part);
        if (checker.isArrayType(part)) out.push({ k: "array", element: checker.getTypeArguments(part)[0] });
        else if (part.symbol?.name === "Uint8Array") out.push({ k: "bytes" });
        else if (properties.length === 0 && infos.length === 1) out.push({ k: "record", values: infos[0].type });
        else if (properties.length > 0 && infos.length === 0) out.push({ k: "object", properties });
        else out.push({ k: "unsupported", text: checker.typeToString(part) });
      } else out.push({ k: "unsupported", text: checker.typeToString(part) });
    }
    if (sawTrue && sawFalse) out.push({ k: "boolean" });
    else if (sawTrue) out.push({ k: "literal", value: true });
    else if (sawFalse) out.push({ k: "literal", value: false });
    return out;
  }

  /** What a schema node allows, one entry per alternative, following `$ref` and flattening `oneOf`/`enum`. */
  function leaves(node, def = null, untagged = false, seen = new Set(), out = []) {
    if (node.$ref !== undefined) {
      const name = refName(node.$ref);
      if (name === null || defs[name] === undefined || seen.has(name)) out.push({ k: "unsupported", text: `$ref ${String(node.$ref)}` });
      else leaves(defs[name], name, UNTAGGED_BYTES.has(name), new Set(seen).add(name), out);
    } else if (node.type === "array" && node.items !== undefined) {
      // Array ordering/length refinements are enforced by schema vectors, not TypeScript.
      out.push({ k: "array", items: node.items });
    } else if (Array.isArray(node.oneOf)) {
      for (const alternative of node.oneOf) leaves(alternative, def, untagged, seen, out);
    } else if (Array.isArray(node.enum)) {
      for (const value of node.enum) out.push({ k: "literal", value });
    } else if (node.const !== undefined) {
      out.push({ k: "literal", value: node.const });
    } else if (node.type === "string") {
      out.push(node.contentEncoding === "base64" ? { k: "bytes" } : { k: "string", untagged });
    } else if (node.type === "integer" || node.type === "number") {
      out.push({ k: "number" });
    } else if (node.type === "boolean" || node.type === "null") {
      out.push({ k: node.type });
    } else if (node.type === "object" && node.properties !== undefined) {
      out.push({ k: "object", properties: node.properties, required: new Set(node.required ?? []), def });
    } else if (node.type === "object" && typeof node.additionalProperties === "object") {
      out.push({ k: "record", values: node.additionalProperties });
    } else out.push({ k: "unsupported", text: JSON.stringify(node).slice(0, 60) });
    return out;
  }

  const show = (value) => JSON.stringify(value);
  const describeMember = (member) =>
    member.k === "literal" ? show(member.value) : member.k === "unsupported" ? `a type this check cannot compare (${member.text})` : member.k;
  const describeLeaf = (leaf) =>
    leaf.k === "literal" ? show(leaf.value) : leaf.k === "unsupported" ? `a construct this check cannot compare (${leaf.text})` : leaf.k;
  const kindOf = (properties) => {
    const kind = properties.find((property) => property.name === "kind");
    const type = kind === undefined ? undefined : checker.getTypeOfSymbol(kind);
    return type !== undefined && type.flags & ts.TypeFlags.StringLiteral ? type.value : undefined;
  };

  function compareMember(member, leaf, path) {
    if (member.k === "bytes" && leaf.k === "string" && leaf.untagged) return [];
    if (member.k !== leaf.k) return [`${path}: TypeScript has ${describeMember(member)}; the schema has ${describeLeaf(leaf)}`];
    switch (member.k) {
      case "literal":
        return member.value === leaf.value ? [] : [`${path}: literal ${show(member.value)} is not ${show(leaf.value)}`];
      case "array":
        return compareUnion(member.element, leaf.items, `${path}[]`);
      case "record":
        return compareUnion(member.values, leaf.values, `${path}{}`);
      case "object": {
        const kind = kindOf(member.properties);
        const here = kind === undefined ? path : `${path}<${kind}>`;
        const issues = [];
        const where = leaf.def === null ? "the schema object" : `schema definition ${leaf.def}`;
        const declared = new Set(member.properties.map((property) => property.name));
        for (const property of member.properties) {
          if (!Object.prototype.hasOwnProperty.call(leaf.properties, property.name)) {
            issues.push(`${here}: TypeScript has key "${property.name}" that ${where} lacks`);
            continue;
          }
          const optional = (property.flags & ts.SymbolFlags.Optional) !== 0;
          if (optional === leaf.required.has(property.name)) {
            issues.push(`${here}.${property.name}: ${optional ? "optional" : "required"} in TypeScript but ${optional ? "required" : "optional"} in the schema`);
          }
          issues.push(...compareUnion(checker.getTypeOfSymbol(property), leaf.properties[property.name], `${here}.${property.name}`));
        }
        for (const name of Object.keys(leaf.properties)) {
          if (!declared.has(name)) issues.push(`${here}: ${where} has key "${name}" that the TypeScript type lacks`);
        }
        return issues;
      }
      case "unsupported":
        return [`${path}: ${describeMember(member)}`];
      default:
        return [];
    }
  }

  /** The TypeScript type and the schema node allow the same alternatives, each described the same way. */
  function compareUnion(type, node, path) {
    const key = `${id(typeIds, type)}:${id(nodeIds, node)}`;
    if (onStack.has(key)) return []; // a recursive type (PlainData) is equal to itself
    onStack.add(key);
    try {
      const alternatives = leaves(node);
      const matched = new Set();
      const issues = [];
      for (const member of members(type)) {
        let best = null;
        let bestLeaf = null;
        let foundZero = false;
        for (const leaf of alternatives) {
          // Same `kind` means this is the intended pairing even if nested shapes differ;
          // report those differences at the nested path, not as a missing alternative here.
          if (member.k === "object" && leaf.k === "object") {
            const memberKind = kindOf(member.properties);
            const leafKind = leaf.properties?.kind?.const;
            if (memberKind !== undefined && leafKind !== undefined && memberKind !== leafKind) continue;
          }
          const attempt = compareMember(member, leaf, path);
          if (attempt.length === 0) {
            matched.add(leaf);
            foundZero = true;
            break;
          }
          if (best === null || attempt.length < best.length) {
            best = attempt;
            bestLeaf = leaf;
          }
        }
        if (foundZero) continue;
        if (best !== null) {
          matched.add(bestLeaf);
          if (member.k === "literal" && bestLeaf?.k === "literal") {
            issues.push(`${path}: TypeScript allows ${show(member.value)}; the schema does not`);
          } else {
            issues.push(...best);
          }
        } else if (member.k === "literal") {
          issues.push(`${path}: TypeScript allows ${show(member.value)}; the schema does not`);
        } else {
          issues.push(`${path}: TypeScript has ${describeMember(member)}; the schema has no matching alternative`);
        }
      }
      for (const leaf of alternatives) {
        if (!matched.has(leaf)) issues.push(`${path}: the schema allows ${describeLeaf(leaf)}; the TypeScript type does not`);
      }
      return issues;
    } finally {
      onStack.delete(key);
    }
  }

  for (const root of roots) {
    const source = program.getSourceFile(join(repo, root.file));
    const declaration = source?.statements.find((statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === root.alias);
    if (declaration === undefined) {
      problems.push(`${root.file}: no exported type ${root.alias}; the runner schema ($defs.${root.def}) has nothing to describe`);
      continue;
    }
    problems.push(...compareUnion(checker.getDeclaredTypeOfSymbol(checker.getSymbolAtLocation(declaration.name)), { $ref: `#/$defs/${root.def}` }, root.alias));
  }
  return problems;
}

/** The text of one repository file, for callers that perturb it. */
export function readSource(path) {
  return readFileSync(join(repo, path), "utf8");
}
