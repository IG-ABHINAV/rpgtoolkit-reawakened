// Test-only prefix, evaluated in the same AudioWorklet global as the shipped processor.
const probeInstantiate = WebAssembly.instantiate;
let probeRelease;
let probeReject;
WebAssembly.instantiate = (...args) => new Promise((resolve, reject) => {
  probeRelease = () => probeInstantiate(...args).then(resolve, reject);
  probeReject = () => reject(new Error("worklet-decoder-probe-failure"));
});
registerProcessor("decoder-probe-control", class extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      if (data.kind === "pending") {
        if (probeRelease === undefined) throw new Error("decoder did not start");
        this.port.postMessage({ kind: "pending" });
      } else if (data.kind === "resolve") {
        probeRelease().then(() => this.port.postMessage({ kind: "decoded" }));
        this.port.postMessage({ kind: "released" });
      } else if (data.kind === "resolve-held") {
        // A release acknowledgement does not mean asynchronous instantiation has completed.
        this.port.postMessage({ kind: "released" });
      } else if (data.kind === "finish") {
        probeRelease().then(() => this.port.postMessage({ kind: "decoded" }));
      } else if (data.kind === "reject") probeReject();
    };
  }
  process() { return true; }
});
registerProcessor("decoder-probe-meter", class extends AudioWorkletProcessor {
  constructor() {
    super();
    this.remaining = 0;
    this.energy = 0;
    this.port.onmessage = ({ data }) => {
      if (data.kind === "measure") { this.remaining = data.frames; this.energy = 0; }
    };
  }
  process(inputs) {
    if (this.remaining > 0) {
      const input = inputs[0] ?? [];
      const count = Math.min(this.remaining, input[0]?.length ?? 128);
      for (const channel of input) for (let i = 0; i < count; i++) this.energy += Math.abs(channel[i] ?? 0);
      this.remaining -= count;
      if (this.remaining <= 0) this.port.postMessage({ kind: "measured", energy: this.energy });
    }
    return true;
  }
});
