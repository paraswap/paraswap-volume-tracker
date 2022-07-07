import { StatusCodes } from 'http-status-codes';
import { ClientSideError } from './client-side-error';

export class BadRequestError extends ClientSideError {
  constructor(message: string) {
    super(message, StatusCodes.BAD_REQUEST);
  }
}
