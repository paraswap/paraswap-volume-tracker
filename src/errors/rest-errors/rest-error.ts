import { ApplicationError } from '../application-error';

export class RestError extends ApplicationError {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}
