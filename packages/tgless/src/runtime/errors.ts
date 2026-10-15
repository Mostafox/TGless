/**
 * Throw from an endpoint to refuse the Mini App's call.
 * The runtime converts it to the platform's `EndpointError`, so the client gets
 * `{ ok: false, error_type: 'ENDPOINT_ERROR', description, parameters }`.
 */
export class EndpointError extends Error {
  constructor(
    readonly description: string,
    readonly parameters: Record<string, unknown> = {},
  ) {
    super(description);
    this.name = 'EndpointError';
  }
}

/** Shortcut: `throw fail('Out of stock', { code: 'OUT_OF_STOCK' })`. */
export function fail(description: string, parameters?: Record<string, unknown>): EndpointError {
  return new EndpointError(description, parameters);
}

/** Thrown by a guard to stop a handler; optionally tells the user why. */
export class ForbiddenError extends Error {
  constructor(readonly userMessage?: string) {
    super(userMessage ?? 'Forbidden');
    this.name = 'ForbiddenError';
  }
}

/** Raised when endpoint input fails validation. */
export class ValidationError extends EndpointError {
  constructor(issues: unknown) {
    super('Invalid input', { code: 'VALIDATION_ERROR', issues });
    this.name = 'ValidationError';
  }
}
