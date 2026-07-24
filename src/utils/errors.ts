export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Resource not found") {
    super(404, message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden") {
    super(403, message);
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "Bad request") {
    super(400, message);
  }
}

/** Another run already holds the processing lock for this (employeeId, payPeriodId). */
export class LockConflictError extends HttpError {
  constructor(employeeId: string, payPeriodId: string) {
    super(409, `Employee ${employeeId} is already being processed for pay period ${payPeriodId}`);
    this.name = "LockConflictError";
  }
}

/** The lock's lease expired and was reaped out from under an in-flight processing run — abort immediately. */
export class LockLostError extends HttpError {
  constructor(employeeId: string, payPeriodId: string) {
    super(409, `Processing lock for employee ${employeeId} / pay period ${payPeriodId} was lost (lease expired)`);
    this.name = "LockLostError";
  }
}

/** A configuration is missing something required to proceed (e.g. no PayrollCalendar row for a resolved period). */
export class ConfigurationError extends HttpError {
  constructor(message: string) {
    super(422, message);
    this.name = "ConfigurationError";
  }
}
