import { AccountToCreate } from './types';

// convient for inheritance cascading property of instanceof
export class OnBoardingError extends Error {}

export class ValidationError extends OnBoardingError {
  constructor(message: string) {
    super(`ValidationError: ${message}`);
  }
}

export class AccountCreationError extends OnBoardingError {
  constructor(account: AccountToCreate) {
    super(
      `AccountCreationError: account=${JSON.stringify(
        account,
      )} did not get created.`,
    );
  }
}

export class DuplicatedAccountError extends OnBoardingError {
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

export class AccountNotFoundError extends OnBoardingError {
  constructor(uuid: string) {
    super(`Account not found uuid=${uuid}`);
  }
}

export class AuthorizationError extends ValidationError {
  constructor() {
    super(`wrong token`);
  }
}
