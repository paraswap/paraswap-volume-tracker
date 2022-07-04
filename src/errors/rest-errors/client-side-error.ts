import { RestError } from './rest-error';

export class ClientSideError extends RestError {
  // eslint-disable-next-line no-useless-constructor
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
  }
}
