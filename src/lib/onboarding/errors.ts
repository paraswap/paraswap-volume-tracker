import {
  AccountToCreate,
  AccountWithSigToSubmit,
  RegisteredAccount,
} from './types';

// convient for inheritance cascading property of instanceof
export class OnBoardingError extends Error {
  constructor(message: string) {
    super(message);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OnBoardingError);
    }
  }
}

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

export class VerificationError extends OnBoardingError {
  constructor() {
    super(`VerificationError`);
  }
}

export class AccountDeleteError extends OnBoardingError {
  constructor({ uuid }: Pick<RegisteredAccount, 'uuid'>) {
    super(`AccountDeleteError: uuid=${uuid} did not get deleted.`);
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

export class AccountByUUIDNotFoundError extends OnBoardingError {
  constructor({ uuid }: Pick<RegisteredAccount, 'uuid'>) {
    super(`Account not found uuid=${uuid}`);
  }
}

export class AccountByEmailNotFoundError extends OnBoardingError {
  constructor({ email }: Pick<RegisteredAccount, 'email'>) {
    super(`Account not found email=${email}`);
  }
}

export class AuthorizationError extends ValidationError {
  constructor() {
    super(`wrong token`);
  }
}

export class DuplicatedStakerEmail extends OnBoardingError {
  constructor({ email }: { email: string }) {
    super(`${email} has already registered for beta`);
  }
}

/// FALLBACK ONLY
export class AccountWithSigNonValidError extends ValidationError {
  constructor(payload: any) {
    super(
      `Invalid account format. Expecting {email: string, sig: string}, received: ${JSON.stringify(
        payload,
      )}`,
    );
  }
}

export class DuplicatedAccountWithSigError extends OnBoardingError {
  constructor({ address }: AccountWithSigToSubmit) {
    super(`${address} already submitted an email previously`);
  }
}

export class InvalidSigErrror extends OnBoardingError {
  constructor({ sig, address }: AccountWithSigToSubmit) {
    super(`Invalid signature ${sig} for ${address}`);
  }
}

export class AccountNotEligible extends OnBoardingError {
  constructor() {
    super(`address has less than 100$ worth of PSP staked`);
  }
}
