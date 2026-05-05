export type PaytagErrorCode =
  | 'USER_NOT_FOUND'
  | 'INVALID_USERNAME'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'HTTP_ERROR'
  | 'CONFIG_ERROR';

export class PaytagError extends Error {
  readonly code: PaytagErrorCode;
  readonly status?: number;

  constructor(message: string, code: PaytagErrorCode, status?: number) {
    super(message);
    this.name = 'PaytagError';
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, PaytagError.prototype);
  }
}
