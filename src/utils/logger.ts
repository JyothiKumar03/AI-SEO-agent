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

const formatMeta = (meta?: LogMeta): string => {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }

  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return "";
  }
};

const logWithLevel = (
  scope: string,
  level: LogLevel,
  message: string,
  meta?: LogMeta,
): void => {
  const timestamp = new Date().toISOString();
  const formattedMeta = formatMeta(meta);
  // eslint-disable-next-line no-console
  console.log(`[${timestamp}] [${scope}] [${level.toUpperCase()}] ${message}${formattedMeta}`);
};

export const createLogger = (scope: string): ScopedLogger => {
  const buildLogger =
    (level: LogLevel) =>
    (message: string, meta?: LogMeta): void => {
      logWithLevel(scope, level, message, meta);
    };

  const measure = async <T>(
    step: string,
    runner: () => Promise<T>,
  ): Promise<{ result: T; durationMs: number }> => {
    const start = performance.now();
    logWithLevel(scope, "info", `${step}::start`);

    try {
      const result = await runner();
      const durationMs = performance.now() - start;
      logWithLevel(scope, "info", `${step}::success`, {
        durationMs: Number(durationMs.toFixed(2)),
      });

      return { result, durationMs };
    } catch (error) {
      const durationMs = performance.now() - start;
      logWithLevel(scope, "error", `${step}::error`, {
        durationMs: Number(durationMs.toFixed(2)),
        message: error instanceof Error ? error.message : "unknown error",
      });
      throw error;
    }
  };

  return {
    debug: buildLogger("debug"),
    info: buildLogger("info"),
    warn: buildLogger("warn"),
    error: buildLogger("error"),
    measure,
  };
};
