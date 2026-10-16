/**
 * Local/CI-friendly Tauri build with updater signing.
 * Uses TAURI_SIGNING_PRIVATE_KEY if set; otherwise src-tauri/.updater/blaze.key
 * (gitignored, same keypair as pubkey in tauri.conf.json).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keyPath = path.join(root, "src-tauri", ".updater", "blaze.key");

const env = { ...process.env };

if (!env.TAURI_SIGNING_PRIVATE_KEY?.trim()) {
  if (!fs.existsSync(keyPath)) {
    console.error(
      [
        "No hay clave de firmado del updater.",
        `Esperaba: ${keyPath}`,
        "O seteá TAURI_SIGNING_PRIVATE_KEY (contenido o ruta al .key).",
        'Generá una con: npx tauri signer generate -w src-tauri/.updater/blaze.key --ci',
      ].join("\n"),
    );
    process.exit(1);
  }
  env.TAURI_SIGNING_PRIVATE_KEY = keyPath;
  console.log(`Firmando updater con ${path.relative(root, keyPath)}`);
}

if (env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined) {
  // Clave local sin password (mismo criterio que secrets vacíos en CI).
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
}

const args = ["tauri", "build", ...process.argv.slice(2)];
const child = spawn("npx", args, {
  cwd: root,
  env,
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
