import { ApplicationError } from './application-error';

export class ConfigError extends ApplicationError {
  // eslint-disable-next-line no-useless-constructor
  constructor(message: string) {
    super(message);
  }
}
