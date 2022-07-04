import { StatusCodes } from 'http-status-codes';
import { ClientSideError } from './client-side-error';

export class NotFoundError extends ClientSideError {
  constructor(message: string) {
    super(message, StatusCodes.NOT_FOUND);
  }
}
