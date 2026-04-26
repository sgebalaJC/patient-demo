import * as p from "@clack/prompts";
import pc from "picocolors";
import type {Logger} from "./types.ts";

export function createLogger(): Logger {
  return {
    info: (msg) => p.log.info(msg),
    success: (msg) => p.log.success(pc.green(msg)),
    warn: (msg) => p.log.warn(pc.yellow(msg)),
    error: (msg) => p.log.error(pc.red(msg)),
    step: (msg) => p.log.step(pc.cyan(msg)),
    spinner: (label) => {
      const s = p.spinner();
      s.start(label);
      return {
        update: (l: string) => s.message(l),
        stop: (l?: string) => s.stop(l ?? label),
        fail: (l?: string) => s.stop(pc.red(l ?? `${label} — failed`), 1),
      };
    },
  };
}
