// The RPGCode frontend (docs/spec/engine/rpgcode-functions.md#rpgcode-built-in-commands/§9.12; ADR 0004
// decision 1): the tokenizer, construct rejections, leniency forms and the
// exact Step IR the tracer program lowers to.
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { compileInline, compileProgram, tokenize as lexTokens, type ScriptError, type Token } from "../src/index.ts";

/**
 * These assertions pin the token stream's shape without its spans: `col` and
 * `endCol` are covered by `script-lex-spans.test.ts`, and repeating them in
 * every literal here would bury the frontend behaviour the file tests.
 */
const tokenize = (text: string): Array<Omit<Token, "col" | "endCol">> =>
  lexTokens(text).map(({ col: _col, endCol: _endCol, ...rest }) => rest);

function errorOf(run: () => unknown): { code: string; message: string } {
  try {
    run();
  } catch (error) {
    const scriptError = error as ScriptError;
    equal(typeof scriptError.code, "string");
    return { code: scriptError.code, message: scriptError.message };
  }
  throw new Error("expected the call to throw");
}
test("inline package startups give their lambdas distinct stable identities", () => {
  const text = "f = (x) => x\n";
  const alpha = compileProgram({ kind: "inline", text, ir: "1", owner: "alpha" });
  const beta = compileProgram({ kind: "inline", text, ir: "1", owner: "beta" });
  deepEqual(Object.keys(alpha.functions), ["<package:alpha>#lambda_1"]);
  deepEqual(Object.keys(beta.functions), ["<package:beta>#lambda_1"]);
});
test("all documented compile-time constants tokenize case-insensitively as their numeric values", () => {
  const constants: Readonly<Record<string, number>> = {
    tkMV_PAUSE_THREAD: 1, tkMV_CLEAR_QUEUE: 2, tkMV_PATHFIND: 4,
    tkMV_WAYPOINT_PATH: 8, tkMV_WAYPOINT_LINK: 16,
    tkVT_SOLID: 1, tkVT_UNDER: 2, tkVT_STAIRS: 8, tkVT_WAYPOINT: 16,
    tkVT_BKGIMAGE: 1, tkVT_ALL_LAYERS_BELOW: 2, tkVT_FRAME_INTERSECT: 4,
    tkPRG_STEP: 0, tkPRG_KEYPRESS: 1, tkPRG_REPEAT: 2, tkPRG_STOPS_MOVEMENT: 4,
    tkDIR_E: 1, tkDIR_SE: 2, tkDIR_S: 3, tkDIR_SW: 4,
    tkDIR_W: 5, tkDIR_NW: 6, tkDIR_N: 7, tkDIR_NE: 8,
  };
  for (const [name, value] of Object.entries(constants)) {
    deepEqual(tokenize(name), [{ kind: "number", value, line: 1 }, { kind: "eof", line: 1 }], name);
  }
  deepEqual(tokenize('"tkMV_WAYPOINT_LINK"'), [{ kind: "string", value: "tkMV_WAYPOINT_LINK", line: 1 }, { kind: "eof", line: 1 }]);
});


test("tokenizes case-folded identifiers with sigils stripped", () => {
  deepEqual(tokenize('Count! = 2 ; name$ = "hi"\nend'), [
    { kind: "identifier", name: "count", line: 1 },
    { kind: "op", text: "=", line: 1 },
    { kind: "number", value: 2, line: 1 },
    { kind: "end", line: 1 },
    { kind: "identifier", name: "name", line: 1 },
    { kind: "op", text: "=", line: 1 },
    { kind: "string", value: "hi", line: 1 },
    { kind: "end", line: 1 },
    { kind: "identifier", name: "end", line: 2 },
    { kind: "eof", line: 2 },
  ]);

  // `x!=1` is the `!=` operator (LEX-3); `x! = 1` keeps the sigil reading.
  deepEqual(tokenize("x!=1"), [
    { kind: "identifier", name: "x", line: 1 },
    { kind: "op", text: "!=", line: 1 },
    { kind: "number", value: 1, line: 1 },
    { kind: "eof", line: 1 },
  ]);
  deepEqual(tokenize("x! = true"), [
    { kind: "identifier", name: "x", line: 1 },
    { kind: "op", text: "=", line: 1 },
    { kind: "number", value: 1, line: 1 },
    { kind: "eof", line: 1 },
  ]);

  // `$` followed by `=` is a sigil, only `!` followed by `=` is the operator.
  deepEqual(tokenize('name$="hi"'), [
    { kind: "identifier", name: "name", line: 1 },
    { kind: "op", text: "=", line: 1 },
    { kind: "string", value: "hi", line: 1 },
    { kind: "eof", line: 1 },
  ]);
});

test("tokenizes every lexical operator, comment form and the `_` continuation with line numbers", () => {
  // Comments and line continuation
  const source = `x = 1 /* block
comment */ + 2 _ // continuation
+ 3
** legacy comment
* comment at line start
x = 4 * 5
`;
  const tokens = tokenize(source);
  deepEqual(tokens, [
    { kind: "identifier", name: "x", line: 1 },
    { kind: "op", text: "=", line: 1 },
    { kind: "number", value: 1, line: 1 },
    { kind: "op", text: "+", line: 2 },
    { kind: "number", value: 2, line: 2 },
    { kind: "op", text: "+", line: 3 },
    { kind: "number", value: 3, line: 3 },
    { kind: "end", line: 3 },
    { kind: "end", line: 4 },
    { kind: "end", line: 5 },
    { kind: "identifier", name: "x", line: 6 },
    { kind: "op", text: "=", line: 6 },
    { kind: "number", value: 4, line: 6 },
    { kind: "op", text: "*", line: 6 },
    { kind: "number", value: 5, line: 6 },
    { kind: "end", line: 6 },
    { kind: "eof", line: 7 },
  ]);
});

test("rejects the TK2, class, module and error-handling constructs by name and entry", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["class C { }", "entry 6"],
    ["struct S { }", "entry 6"],
    ["var v = 1", "entry 6"],
    ["public: method f() { }", "entry 6"],
    ["private: method f() { }", "entry 6"],
    ["protected: method f() { }", "entry 6"],
    ["this.x", "entry 6"],
    ["new C()", "entry 6"],
    ["x->y", "entry 6"],
    ["method C::C() { }", "entry 6"],
    ["@", "entry 15"],
  ];

  for (const [src, entry] of cases) {
    const error = errorOf(() => tokenize(src));
    equal(error.code, "syntax.unsupported", src);
    equal(error.message.includes(entry), true, `${src} -> ${error.message}`);
  }

  // break and continue name the spec
  equal(errorOf(() => tokenize("break")).code, "syntax.unsupported");
  equal(errorOf(() => tokenize("break")).message.includes("rpgcode-language.md"), true);
  equal(errorOf(() => tokenize("continue")).code, "syntax.unsupported");
  equal(errorOf(() => tokenize("continue")).message.includes("rpgcode-language.md"), true);

  // An unknown character is a lexical error (LEX-11), not an unsupported construct.
  equal(errorOf(() => tokenize("x = 1 \\")).code, "syntax.error");
  equal(errorOf(() => tokenize('x = "unterminated')).code, "syntax.error");
  equal(errorOf(() => tokenize("x = 1e400")).code, "syntax.error");
});

test("parses the seven corpus-settled leniency forms", () => {
  // 1. Brace on the next line
  equal(compileInline("if (x)\n{\n  y = 1\n}\n").ops.length > 0, true);

  // 2. case (1) without a colon
  equal(compileInline('switch (x) {\n  case (1)\n  { return "one" }\n}\n').ops.length > 0, true);

  // 3. else on a later line
  equal(compileInline("if (x) {\n  y = 1\n}\nelse {\n  y = 2\n}\n").ops.length > 0, true);

  // 4. Typed parameter (CArray rhs)
  equal(compileInline("method clone(CArray rhs) {\n  return 0\n}\n").ops.length > 0, true);

  // 5. local(x) = v as a for initialiser
  equal(compileInline("for (local(i) = 0; i < 3; ++i) {\n  y = 1\n}\n").ops.length > 0, true);

  // 6. return &a[i]
  equal(compileInline("function f() {\n  return &a[i]\n}\n").ops.length > 0, true);

  // 7. a[ident] bare identifier index
  equal(compileInline("y = a[i]\n").ops.length > 0, true);
});

test("rejects a brace-less body naming STX-1", () => {
  const errIf = errorOf(() => compileInline("if (x) y = 1\n"));
  equal(errIf.code, "syntax.unsupported");
  equal(errIf.message.includes("STX-1"), true);

  const errWhile = errorOf(() => compileInline("while (x) y = 1\n"));
  equal(errWhile.code, "syntax.unsupported");
  equal(errWhile.message.includes("STX-1"), true);

  const errUntil = errorOf(() => compileInline("until (x) y = 1\n"));
  equal(errUntil.code, "syntax.unsupported");
  equal(errUntil.message.includes("STX-1"), true);
});

test("accepts comments, a legacy # line and the numeric literals", () => {
  deepEqual(tokenize("x = 1 // trailing"), [
    { kind: "identifier", name: "x", line: 1 },
    { kind: "op", text: "=", line: 1 },
    { kind: "number", value: 1, line: 1 },
    { kind: "eof", line: 1 },
  ]);
  deepEqual(tokenize("// whole line\nx = 1"), [
    { kind: "end", line: 1 },
    { kind: "identifier", name: "x", line: 2 },
    { kind: "op", text: "=", line: 2 },
    { kind: "number", value: 1, line: 2 },
    { kind: "eof", line: 2 },
  ]);
  deepEqual(tokenize("#legacy command"), [{ kind: "eof", line: 1 }]);
  deepEqual(tokenize("1.5"), [{ kind: "number", value: 1.5, line: 1 }, { kind: "eof", line: 1 }]);
  deepEqual(tokenize("2e3"), [{ kind: "number", value: 2000, line: 1 }, { kind: "eof", line: 1 }]);
  deepEqual(tokenize("null"), [{ kind: "number", value: 0, line: 1 }, { kind: "eof", line: 1 }]);
});

test("lowers a bare identifier to a zero-argument call", () => {
  // The call and its `pop` carry the `end` token's span; the synthesized closing
  // `return` has no token, so it keeps `file` and `line` only
  // (docs/spec/engine/rpgcode-tooling.md#tool-3-range-convention).
  deepEqual(compileInline("end\n").ops, [
    { op: "call", name: "end", argc: 0, pos: { file: "<inline>", line: 1, col: 1, endCol: 3 } },
    { op: "pop", pos: { file: "<inline>", line: 1, col: 1, endCol: 3 } },
    { op: "return", pos: { file: "<inline>", line: 1 } },
  ]);
});

test("lowers the tracer program to the exact op array", () => {
  const program = compileInline(
    'greeting = "hi"\ncount = 2\nsleep(count)\ncount = 3\nend()\n',
  );
  deepEqual(program.ref, {
    kind: "inline",
    text: 'greeting = "hi"\ncount = 2\nsleep(count)\ncount = 3\nend()\n',
    ir: "1",
  });
  deepEqual(program.ops, [
    { op: "load", name: "greeting", pos: { file: "<inline>", line: 1, col: 1, endCol: 8 } },
    { op: "push", value: "hi", pos: { file: "<inline>", line: 1, col: 12, endCol: 15 } },
    { op: "storeRef", pos: { file: "<inline>", line: 1, col: 10, endCol: 10 } },
    { op: "pop", pos: { file: "<inline>", line: 1, col: 10, endCol: 10 } },
    { op: "load", name: "count", pos: { file: "<inline>", line: 2, col: 1, endCol: 5 } },
    { op: "push", value: 2, pos: { file: "<inline>", line: 2, col: 9, endCol: 9 } },
    { op: "storeRef", pos: { file: "<inline>", line: 2, col: 7, endCol: 7 } },
    { op: "pop", pos: { file: "<inline>", line: 2, col: 7, endCol: 7 } },
    { op: "load", name: "count", pos: { file: "<inline>", line: 3, col: 7, endCol: 11 } },
    { op: "call", name: "sleep", argc: 1, pos: { file: "<inline>", line: 3, col: 1, endCol: 5 } },
    { op: "pop", pos: { file: "<inline>", line: 3, col: 1, endCol: 5 } },
    { op: "load", name: "count", pos: { file: "<inline>", line: 4, col: 1, endCol: 5 } },
    { op: "push", value: 3, pos: { file: "<inline>", line: 4, col: 9, endCol: 9 } },
    { op: "storeRef", pos: { file: "<inline>", line: 4, col: 7, endCol: 7 } },
    { op: "pop", pos: { file: "<inline>", line: 4, col: 7, endCol: 7 } },
    { op: "call", name: "end", argc: 0, pos: { file: "<inline>", line: 5, col: 1, endCol: 3 } },
    { op: "pop", pos: { file: "<inline>", line: 5, col: 1, endCol: 3 } },
    { op: "return", pos: { file: "<inline>", line: 5 } },
  ]);

  // A file reference needs a source loader; without one it is refused.
  equal(
    errorOf(() =>
      compileProgram({ kind: "file", path: "a.prg", sourceHash: "0", ir: "1" }),
    ).code,
    "program.file-unsupported",
  );
});
