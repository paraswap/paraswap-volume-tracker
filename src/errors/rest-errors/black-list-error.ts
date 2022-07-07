import { ApplicationError } from '../application-error';

export class BlackListError extends ApplicationError {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}
