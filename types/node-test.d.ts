// Module-only declarations for the built-in test runner, shared by the packages
// whose tsconfig.test.json includes this file. Those configs keep `types: []`
// (G2), so @types/node is absent; these declarations add no globals.
declare module "node:test" {
  export interface TestContext {
    test(name: string, fn: () => void | Promise<void>): Promise<void>;
    diagnostic(message: string): void;
  }
  export function test(name: string, fn: (context: TestContext) => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function test(
    name: string,
    options: { skip?: string | boolean },
    fn: () => void | Promise<void>,
  ): void;
  export default test;
}
declare module "node:assert/strict" {
  export function equal(actual: unknown, expected: unknown, message?: string): void;
  export function deepEqual(actual: unknown, expected: unknown, message?: string): void;
  export function throws(fn: () => unknown, expected?: unknown, message?: string): void;
  export function ok(value: unknown, message?: string): asserts value;
  export function rejects(fn: (() => Promise<unknown>) | Promise<unknown>, expected?: unknown, message?: string): Promise<void>;
}
