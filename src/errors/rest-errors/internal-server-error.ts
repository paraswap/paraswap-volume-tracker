import { StatusCodes } from 'http-status-codes';
import { RestError } from './rest-error';

export class InternalServerError extends RestError {
  constructor(message: string) {
    super(message, StatusCodes.INTERNAL_SERVER_ERROR);
  }
}
