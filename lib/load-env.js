import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** slide-upa/.env を読み込む（複数回呼んでも安全） */
export function loadSlideUpaEnv() {
  dotenv.config({ path: path.join(ROOT, ".env") });
}

export const SLIDE_UPA_ROOT = ROOT;
