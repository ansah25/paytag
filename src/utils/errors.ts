export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', errorCode = 'BAD_REQUEST') {
    super(400, errorCode, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', errorCode = 'UNAUTHORIZED') {
    super(401, errorCode, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', errorCode = 'NOT_FOUND') {
    super(404, errorCode, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', errorCode = 'CONFLICT') {
    super(409, errorCode, message);
  }
}
