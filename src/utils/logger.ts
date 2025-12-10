import { performance } from "node:perf_hooks";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogMeta = Record<string, unknown>;

export interface ScopedLogger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  measure<T>(
    step: string,
    runner: () => Promise<T>,
  ): Promise<{ result: T; durationMs: number }>;
}

const format_meta = (meta?: LogMeta): string => {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }

  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return "";
  }
};

const log_with_level = (
  scope: string,
  level: LogLevel,
  message: string,
  meta?: LogMeta,
): void => {
  const timestamp = new Date().toISOString();
  const formatted_meta = format_meta(meta);
  // eslint-disable-next-line no-console
  console.log(`[${timestamp}] [${scope}] [${level.toUpperCase()}] ${message}${formatted_meta}`);
};

export const create_logger = (scope: string): ScopedLogger => {
  const build_logger =
    (level: LogLevel) =>
    (message: string, meta?: LogMeta): void => {
      log_with_level(scope, level, message, meta);
    };

  const measure = async <T>(
    step: string,
    runner: () => Promise<T>,
  ): Promise<{ result: T; durationMs: number }> => {
    const start = performance.now();
    log_with_level(scope, "info", `${step}::start`);

    try {
      const result = await runner();
      const durationMs = performance.now() - start;
      log_with_level(scope, "info", `${step}::success`, {
        durationMs: Number(durationMs.toFixed(2)),
      });

      return { result, durationMs };
    } catch (error) {
      const durationMs = performance.now() - start;
      log_with_level(scope, "error", `${step}::error`, {
        durationMs: Number(durationMs.toFixed(2)),
        message: error instanceof Error ? error.message : "unknown error",
      });
      throw error;
    }
  };

  return {
    debug: build_logger("debug"),
    info: build_logger("info"),
    warn: build_logger("warn"),
    error: build_logger("error"),
    measure,
  };
};

export const createLogger = create_logger;
