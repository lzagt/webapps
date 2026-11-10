/**
 * Emulator configuration, resolved in this order (first wins):
 *   1. VITE_* env vars (.env, .env.local, .env.[mode], shell)
 *   2. Ports from firebase.json "emulators" (injected by vite.config.ts)
 *   3. Firebase's standard defaults
 *
 * Env vars:
 *   VITE_USE_EMULATORS            "true" | "false" | "auto" (default: auto = only on localhost/127.0.0.1)
 *   VITE_EMULATOR_HOST            default host for all emulators (default 127.0.0.1)
 *   VITE_FIRESTORE_EMULATOR_HOST / VITE_FIRESTORE_EMULATOR_PORT
 *   VITE_AUTH_EMULATOR_HOST      / VITE_AUTH_EMULATOR_PORT
 */

declare const __FIREBASE_EMULATOR_PORTS__: { firestore?: number; auth?: number } | undefined;

export interface EmulatorEndpoint {
  host: string;
  port: number;
}

export interface EmulatorConfig {
  enabled: boolean;
  firestore: EmulatorEndpoint;
  auth: EmulatorEndpoint;
}

const env = import.meta.env;
const fromJson = typeof __FIREBASE_EMULATOR_PORTS__ !== "undefined" ? __FIREBASE_EMULATOR_PORTS__ ?? {} : {};

function endpoint(
  hostVar: string | undefined,
  portVar: string | undefined,
  jsonPort: number | undefined,
  defaultPort: number,
): EmulatorEndpoint {
  const port = Number(portVar);
  return {
    host: hostVar || env.VITE_EMULATOR_HOST || "127.0.0.1",
    port: portVar && Number.isInteger(port) ? port : jsonPort ?? defaultPort,
  };
}

function isEnabled(): boolean {
  const flag = (env.VITE_USE_EMULATORS ?? "auto").toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

export const emulatorConfig: EmulatorConfig = {
  enabled: isEnabled(),
  firestore: endpoint(env.VITE_FIRESTORE_EMULATOR_HOST, env.VITE_FIRESTORE_EMULATOR_PORT, fromJson.firestore, 8080),
  auth: endpoint(env.VITE_AUTH_EMULATOR_HOST, env.VITE_AUTH_EMULATOR_PORT, fromJson.auth, 9099),
};
