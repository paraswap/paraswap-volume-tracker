import { AccountToCreate } from './types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(`ValidationError: ${message}`);
  }
}

export class AccountCreationError extends Error {
  constructor(account: AccountToCreate) {
    super(
      `AccountCreationError: account=${JSON.stringify(
        account,
      )} did not get created.`,
    );
  }
}

export class DuplicatedAccountError extends Error {
  constructor(account: AccountToCreate) {
    super(`DuplicatedErrorAccount: account=${JSON.stringify(account)}`);
  }
}

export class AccountNonValidError extends ValidationError {
  constructor(payload: any) {
    super(
      `Invalid account format. Expecting {email: string}, received: ${JSON.stringify(
        payload,
      )}`,
    );
  }
}

export class AccountNotFoundError extends Error {
  constructor(uuid: string) {
    super(`Account not found uuid=${uuid}`);
  }
}
