#!/bin/sh
# #1778 research (Opus): complete reproduction of the corrected run.
# Usage (from the repository root, core package already built):
#   INVENTORY=<1778-shared-inputs.json> DEMO=<repo>/fixtures/legacy/demo \
#   LUDO=<ludotheque>/games CHROME=<chrome executable> \
#   sh tools/research/native-data-notations/opus/reproduce.sh [setup|pipeline|browser|all]
# Writes only under $E (default /private/tmp/tkr-1778-opus-experiments) and
# docs/findings/native-data-notations/opus/examples. Never runs game code.
set -eu
E=${E:-/private/tmp/tkr-1778-opus-experiments}
T=tools/research/native-data-notations/opus
STEP=${1:-all}

setup() {
  mkdir -p "$E/bin" "$E/jars" "$E/dl" "$E/inputs/CrystalImmortality"
  ( cd "$E" && [ -f package.json ] || printf '{"name":"tkr-1778-opus-experiments","private":true,"type":"module"}\n' > package.json )
  ( cd "$E" && npm install --save-exact --no-audit --no-fund \
      yaml@2.9.1 js-yaml@5.5.0 @bgotink/kdl@0.4.1 kdljs@0.3.0 smol-toml@1.9.1 \
      @decimalturn/toml-patch@3.3.2 toml-eslint-parser@1.0.3 json5@2.2.3 hjson@3.2.2 \
      jsonc-parser@3.3.1 edn-data@1.2.2 fast-xml-parser@5.12.0 @xmldom/xmldom@0.9.12 \
      ajv@8.20.0 ajv-formats@3.0.1 xmllint-wasm@5.3.0 sdlang@0.2.2 rusty-object-notation@1.0.2 \
      @o3co/ts.hocon@1.14.3 @pushcorn/hocon-parser@1.3.1 @hyperjump/json-schema@1.18.0 esbuild@0.25.12 \
      puppeteer-core@25.16.0 )
  # CLI tools (SHA-256 recorded in candidates.md / README).
  ( cd "$E/dl" \
    && curl -sSLO https://github.com/cue-lang/cue/releases/download/v0.17.1/cue_v0.17.1_darwin_arm64.tar.gz \
    && curl -sSLO https://github.com/dhall-lang/dhall-haskell/releases/download/1.42.2/dhall-1.42.2-aarch64-darwin.tar.bz2 \
    && curl -sSLO https://github.com/dhall-lang/dhall-haskell/releases/download/1.42.2/dhall-json-1.7.12-aarch64-darwin.tar.bz2 \
    && tar -xzf cue_v0.17.1_darwin_arm64.tar.gz -C "$E/bin" cue \
    && tar -xjf dhall-1.42.2-aarch64-darwin.tar.bz2 -C "$E" && tar -xjf dhall-json-1.7.12-aarch64-darwin.tar.bz2 -C "$E" )
  curl -sSL -o "$E/bin/nickel" https://github.com/nickel-lang/nickel/releases/download/1.18.0/nickel-arm64-macos
  curl -sSL -o "$E/bin/pkl" https://github.com/apple/pkl/releases/download/0.33.0/pkl-macos-aarch64
  chmod +x "$E/bin/"*
  for j in com/typesafe/config/1.4.10/config-1.4.10.jar org/clojure/clojure/1.12.3/clojure-1.12.3.jar \
           org/clojure/spec.alpha/0.5.238/spec.alpha-0.5.238.jar org/clojure/core.specs.alpha/0.4.74/core.specs.alpha-0.4.74.jar; do
    curl -sSL -o "$E/jars/$(basename "$j")" "https://repo1.maven.org/maven2/$j"
  done
  # RON reference bridge (isolated rustup in $E/rust).
  export RUSTUP_HOME="$E/rust/rustup" CARGO_HOME="$E/rust/cargo"
  [ -x "$CARGO_HOME/bin/cargo" ] || { curl -sSf https://sh.rustup.rs -o "$E/dl/rustup-init.sh"; sh "$E/dl/rustup-init.sh" -y --no-modify-path --profile minimal --default-toolchain stable; }
  rm -rf "$E/ron-bridge" && cp -R "$T/ron-bridge" "$E/ron-bridge" && ( cd "$E/ron-bridge" && "$CARGO_HOME/bin/cargo" build --release )
  # SDLang probe bundle (its ESM build does not load in Node unbundled).
  printf "export * from '%s/node_modules/sdlang/dist/esm/index.js';\nexport { AstSdlTokenVisitor } from '%s/node_modules/sdlang/dist/esm/ast_visitor.js';\n" "$E" "$E" > "$E/sdl-entry.mjs"
  mkdir -p "$E/bundles" && "$E/node_modules/.bin/esbuild" "$E/sdl-entry.mjs" --bundle --format=esm --outfile="$E/bundles/sdlang.mjs" --log-level=warning
  # Crystal Immortality: nested zip extracted to scratch (installer never run).
  mkdir -p "$E/inputs/CrystalImmortality-zip" && bsdtar -xf "$LUDO/CrystalImmortality/zip.zip" -C "$E/inputs/CrystalImmortality-zip"
  for d in "$E/inputs/CrystalImmortality-zip/Game/Crystalo/"*; do ln -sfn "$d" "$E/inputs/CrystalImmortality/"; done
  ln -sfn "$E/inputs/CrystalImmortality-zip/Main" "$E/inputs/CrystalImmortality/Main"
}

pipeline() {
  node $T/decode-cohort.mjs --inventory "$INVENTORY" --out "$E/decoded" --game demo="$DEMO" \
    --game ChimeranEmpire="$LUDO/ChimeranEmpire" --game Caoquest="$LUDO/Caoquest" --game CrystalImmortality="$E/inputs/CrystalImmortality"
  node $T/project.mjs --decoded "$E/decoded" --out "$E/projection"
  for g in demo Caoquest ChimeranEmpire CrystalImmortality; do node $T/check.mjs "$E/projection/$g/model" --json > "$E/results/check-$g-json.json" || true; done
  node $T/roundtrip-corpus.mjs --projection "$E/projection" --out "$E/results/roundtrip-corpus.json" --write
  rm -rf "$E/results/diffs" "$E/results/experiments.json"
  node $T/experiments.mjs --projection "$E/projection" --work "$E/work" --out "$E/results/experiments.json"
  node $T/walkthrough.mjs --projection "$E/projection" --work "$E/walkthrough" --out "$E/results/walkthrough.json"
  node $T/programmable/run.mjs --bin "$E/bin" --jars "$E/jars" --projection "$E/projection" --work "$E/programmable" --out "$E/results/programmable.json"
  node $T/make-examples.mjs --out docs/findings/native-data-notations/opus/examples
}

browser() {
  B="$E/browser"; mkdir -p "$B"; printf 'export default {};\n' > "$B/shim-empty.js"
  node --input-type=module -e "
    import {readFileSync, writeFileSync} from 'node:fs';
    const doc = JSON.parse(readFileSync('$E/projection/demo/model/scenes/start/scene.json', 'utf8'));
    doc.extensions = { 'com.example.weather': { version: 1, precipitation: 'rain', intensity: 0.25, windFrom: [-1, 0], onStorm: { inline: 'mwin(\"Thunder!\");' } }, 'org.example.lanterns': { version: 3, glow: [255, 200, 120], flicker: true } };
    writeFileSync('$B/input.json', JSON.stringify({ doc, schema: JSON.parse(readFileSync('$T/schemas/native-model.schema.json', 'utf8')) }));"
  printf '%s\n' '<!doctype html><meta charset=utf-8><title>probe</title><pre id=out></pre><script type=module>import {runProbe} from "./probe-browser.mjs"; const input=await (await fetch("./input.json")).json(); window.__result=await runProbe(input); document.getElementById("out").textContent=JSON.stringify(window.__result); document.title="done";</script>' > "$B/index.html"
  NODE_PATH="$E/node_modules" "$E/node_modules/.bin/esbuild" $T/browser-probe.mjs --bundle --format=esm --platform=node --main-fields=module,main \
    --outfile="$B/probe-node.mjs" --log-level=warning "--banner:js=import {createRequire as __cr} from 'node:module'; const require = __cr(import.meta.url);"
  NODE_PATH="$E/node_modules" "$E/node_modules/.bin/esbuild" $T/browser-probe.mjs --bundle --format=esm --platform=browser --minify \
    --outfile="$B/probe-browser.mjs" --log-level=warning \
    --alias:os="$B/shim-empty.js" --alias:fs="$B/shim-empty.js" --alias:path="$B/shim-empty.js" --alias:url="$B/shim-empty.js" --alias:module="$B/shim-empty.js"
  node --input-type=module -e "
    import {readFileSync, writeFileSync} from 'node:fs';
    const {runProbe} = await import('$B/probe-node.mjs');
    const input = JSON.parse(readFileSync('$B/input.json', 'utf8'));
    writeFileSync('$B/node-result.json', JSON.stringify({ node: process.version, result: await runProbe(input), negativeControlAcceptEverythingSchema: (await runProbe({ ...input, schema: true })).ajv2020 }, null, 1));"
  # Browser execution (tested route): cdp-browser-run.mjs serves $B, drives
  # headless $CHROME over CDP with puppeteer-core (scratch install), waits for
  # window.__result and writes browser-result.json and parity.json.
  node $T/cdp-browser-run.mjs "$B" "$CHROME" "$E"
  # Unsupported (not part of the tested route): `chrome --headless=new
  # --dump-dom` hung for 180 s on Chrome 150 in this run; do not rely on it.
}

checks() { node $T/correction-checks.mjs --projection "$E/projection" --decoded "$E/decoded" --results "$E/results" --out "$E/results/correction-checks.json"; }

case "$STEP" in
  setup) setup ;; pipeline) pipeline ;; browser) browser ;; checks) checks ;;
  all) setup; pipeline; browser; checks ;;
esac
