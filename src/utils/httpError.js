export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);

    this.status = status;
    this.details = details;
  }
}