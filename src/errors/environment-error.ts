import { ApplicationError } from './application-error';

export class EnvironmentError extends ApplicationError {
  constructor(key: string) {
    super(`Required environment variable '${key}' expected!`);
  }
}
