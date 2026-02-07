/**
 * Centralized error handling for the application.
 */

export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

export interface AppError {
  message: string;
  code?: string;
  severity: ErrorSeverity;
  timestamp: number;
  context?: any;
}

class ErrorHandler {
  private errors: AppError[] = [];

  /**
   * Logs an error and handles optional side effects (like showing a notification).
   */
  public handleError(
    error: any,
    context?: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
  ) {
    const message = error instanceof Error ? error.message : String(error);
    const appError: AppError = {
      message,
      code: (error as any)?.code,
      severity,
      timestamp: Date.now(),
      context: { context, ...((error as any)?.context ?? {}) },
    };

    this.errors.push(appError);

    // Console logging with colors based on severity
    const prefix = `[Error][${context ?? "Global"}][${severity.toUpperCase()}]`;
    if (severity === ErrorSeverity.CRITICAL) {
      console.error(prefix, message, error);
    } else if (severity === ErrorSeverity.HIGH) {
      console.warn(prefix, message);
    } else {
      console.log(prefix, message);
    }

    // We can add logic here to sync errors to Supabase/SQLite in the future
    return appError;
  }

  public getErrors() {
    return [...this.errors];
  }

  public clearErrors() {
    this.errors = [];
  }
}

export const errorHandler = new ErrorHandler();
