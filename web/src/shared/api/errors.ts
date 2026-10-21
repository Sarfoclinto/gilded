/**
 * One error type for everything the API layer can throw, so screens never inspect raw axios errors.
 * `kind` says where it came from; `code` is the server's stable machine-readable code.
 */
export type ApiErrorKind =
  | 'network' //     no response: offline, DNS, CORS, server down
  | 'timeout'
  | 'offline' //     we refused to send because the device is offline
  | 'http' //        the server answered with an error envelope
  | 'bad-response'; // the server answered, but not in the documented shape

export interface ApiErrorInit {
  kind: ApiErrorKind;
  message: string;
  status?: number;
  code?: string;
  fieldErrors?: Record<string, string[]>;
  traceId?: string;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly traceId?: string;

  constructor(init: ApiErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors;
    this.traceId = init.traceId;
  }

  /** Worth retrying automatically: connection problems and 5xx. Never 4xx. */
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || (this.status !== undefined && this.status >= 500);
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

/** Text that is safe to show a person. */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    switch (e.kind) {
      case 'network':
        return 'Cannot reach the server. Check the connection and try again.';
      case 'timeout':
        return 'The server took too long to answer. Try again.';
      case 'offline':
        return 'You are offline. This action needs a connection.';
      case 'bad-response':
        return 'The server sent something unexpected. Please tell support.';
      default:
        return e.message;
    }
  }
  return 'Something went wrong.';
}
