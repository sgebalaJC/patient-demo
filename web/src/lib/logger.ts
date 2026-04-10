export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  OFF = 4
}

interface LoggerConfig {
  enabled: boolean;
  level: LogLevel;
  includeTimestamp: boolean;
  includePrefix: boolean;
}

class Logger {
  private config: LoggerConfig = {
    enabled: true, //import.meta.env.DEV || import.meta.env.VITE_ENABLE_LOGGING === 'true',
    level: LogLevel.WARN, // Default to only warnings and errors
    includeTimestamp: true,
    includePrefix: true,
  };

  constructor() {
    // Override with environment variables if available
    if (import.meta.env.VITE_LOG_LEVEL) {
      this.config.level = parseInt(import.meta.env.VITE_LOG_LEVEL, 10) as LogLevel;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return this.config.enabled && level >= this.config.level;
  }

  private formatMessage(level: string, message: string, ...args: any[]): [string, ...any[]] {
    let formattedMessage = message;

    if (this.config.includePrefix) {
      formattedMessage = `[${level}] ${formattedMessage}`;
    }

    if (this.config.includeTimestamp) {
      const timestamp = new Date().toISOString();
      formattedMessage = `${timestamp} ${formattedMessage}`;
    }

    return [formattedMessage, ...args];
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(...this.formatMessage('DEBUG', message, ...args));
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(...this.formatMessage('INFO', message, ...args));
    }
  }

  log(message: string, ...args: any[]): void {
    this.info(message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(...this.formatMessage('WARN', message, ...args));
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(...this.formatMessage('ERROR', message, ...args));
    }
  }

  // Configuration methods
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getLevel(): LogLevel {
    return this.config.level;
  }
}

// Create singleton instance
export const logger = new Logger();

// Convenience exports
export const log = logger.log.bind(logger);
export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);

export default logger;
