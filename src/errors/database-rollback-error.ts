import { DatabaseError } from './database-error';

// This error indicates only that we want to rollback, but not send the user InternalServerError
// So this error should be caught after transaction and later returned the value you want
export class DatabaseRollbackError extends DatabaseError {
  // eslint-disable-next-line no-useless-constructor
  constructor(message?: string) {
    super(message || 'Database Rollback');
  }
}
