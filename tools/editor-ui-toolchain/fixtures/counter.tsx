// Toolchain fixture (ADR 0025 decision 2): the smallest component that exercises the JSX transform, a hook, an ARIA
// attribute and a CSSOM `style` prop (decision 6). It is not editor code. `tsc -b` checks it, the esbuild build bundles
// it, and the toolchain tests render it under a DOM shim.
import { useState } from "preact/hooks";

export interface CounterProps {
  readonly label: string;
  readonly start?: number;
}

export function Counter({ label, start = 0 }: CounterProps) {
  const [count, setCount] = useState(start);
  return (
    <button type="button" aria-label={label} style={{ minWidth: "4em" }} onClick={() => setCount(count + 1)}>
      {label}: {count}
    </button>
  );
}
