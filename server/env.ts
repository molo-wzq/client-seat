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
      process.env[match[1]] = stripQuotes(match[2].trim());
    }
  }
}

/** 按 dotenv 惯例剥离值两侧成对的引号:KEY="value" 的值不应含引号。 */
function stripQuotes(value: string): string {
  const double = value.match(/^"(.*)"$/s);
  if (double) return double[1];
  const single = value.match(/^'(.*)'$/s);
  if (single) return single[1];
  return value;
}
