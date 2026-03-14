import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, "..");
export const CONTRACTS_DIR = path.join(REPO_ROOT, "contracts");
export const ARTIFACTS_DIR = path.join(REPO_ROOT, "artifacts");
export const DEPLOYMENTS_DIR = path.join(REPO_ROOT, "deployments");
export const FRONTEND_DIR = path.join(REPO_ROOT, "frontend-local");
export const FRONTEND_ABI_DIR = path.join(REPO_ROOT, "generated", "abis");
export const GENERATED_DIR = path.join(REPO_ROOT, "generated");
export const LAYER_CATALOG_PATH = path.join(GENERATED_DIR, "layer-catalog.json");
export const UPLOAD_MANIFEST_PATH = path.join(REPO_ROOT, "upload-manifest.json");
export const ZK_PHIL_LAYERS_DIR = path.join(REPO_ROOT, "zkPhilLayers");

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function normalizePath(value) {
  return value.split(path.sep).join("/");
}

export function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}
