// Entry point of the toolchain fixture bundle: mounts `Counter` into `#root`.
import { render } from "preact";
import { Counter } from "./counter.tsx";

const root = document.getElementById("root");
if (root === null) throw new Error("toolchain fixture: #root is missing");
render(<Counter label="Count" />, root);
