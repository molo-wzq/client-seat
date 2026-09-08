import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 读取仓库根目录 .env.local(若存在);已设置的环境变量优先。 */
export function loadEnvFile(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const envFile = path.join(root, ".env.local");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  }
}
