import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_FILE = "config/attention.default.json";
const LOCAL_FILE = "config/attention.local.json";

async function readJson(filePath) {
  const source = await readFile(filePath, "utf8");
  return JSON.parse(source);
}

function validateStrategy(value, source) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${source} must contain a JSON object.`);
  }
  if (value.schemaVersion !== 1) {
    throw new TypeError(`${source} must use schemaVersion 1.`);
  }
  if (!Array.isArray(value.domains)) {
    throw new TypeError(`${source} must contain a domains array.`);
  }
  return value;
}

export async function loadAttentionStrategy(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const localPath = path.join(root, LOCAL_FILE);
  try {
    return {
      ...validateStrategy(await readJson(localPath), LOCAL_FILE),
      source: "local",
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const defaultPath = path.join(root, DEFAULT_FILE);
  return {
    ...validateStrategy(await readJson(defaultPath), DEFAULT_FILE),
    source: "default",
  };
}
