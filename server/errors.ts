/** An error that maps cleanly onto an HTTP response. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.hint ? { hint: this.hint } : {}),
      },
    };
  }
}

export const badRequest = (code: string, message: string, hint?: string) =>
  new ApiError(400, code, message, hint);
