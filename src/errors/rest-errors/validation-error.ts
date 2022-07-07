import { BadRequestError } from './bad-request-error';

export class ValidationError extends BadRequestError {
  readonly rawMessage: string;

  readonly key?: string;

  constructor(message: string, key?: string) {
    super(key !== undefined ? `'${key}': ${message}` : message);
    this.rawMessage = message;
    this.key = key;
  }
}
