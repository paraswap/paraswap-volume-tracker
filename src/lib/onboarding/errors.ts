import { AccountToCreate, RegisteredAccount } from './types';

// convient for inheritance cascading property of instanceof
export class OnBoardingError extends Error {}

export class ValidationError extends OnBoardingError {
  constructor(message: string) {
    super(`ValidationError: ${message}`);
  }
}

export class AccountCreationError extends OnBoardingError {
  constructor({ email }: AccountToCreate) {
    super(`AccountCreationError: email=${email} did not get created.`);
  }
}

export class AccountUpdateError extends OnBoardingError {
  constructor({ uuid }: Pick<RegisteredAccount, 'uuid'>) {
    super(`AccountUpdateError: uuid=${uuid} did not get updated.`);
  }
}

export class DuplicatedAccountError extends OnBoardingError {
  constructor({ email }: AccountToCreate) {
    super(`DuplicatedErrorAccount: email=${email}`);
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
  constructor({ uuid }: Pick<RegisteredAccount, 'uuid'>) {
    super(`Account not found uuid=${uuid}`);
  }
}

export class AuthorizationError extends ValidationError {
  constructor() {
    super(`wrong token`);
  }
}
