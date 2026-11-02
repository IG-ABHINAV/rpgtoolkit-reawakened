// Module-only declarations for the Node built-ins the sink tests read. G2 keeps `types: []` in every package's test
// project, so these stand in for @types/node exactly as `packages/synth/test/node-modules.d.ts` does.

interface ImportMeta {
  readonly url: string;
}

declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string): string[];
}
declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
}
declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
declare module "node:http" {
  export interface IncomingMessage {
    readonly headers: Record<string, string | string[] | undefined>;
  }
  export interface ServerResponse {
    writeHead(status: number, headers?: Record<string, string | number>): ServerResponse;
    end(data?: Uint8Array | string): void;
  }
  export interface Server {
    listen(port: number, host: string, listening: () => void): Server;
    close(callback?: () => void): Server;
    closeAllConnections(): void;
    address(): { readonly port: number } | string | null;
  }
  export function createServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Server;
}
