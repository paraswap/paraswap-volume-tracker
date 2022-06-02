import * as express from 'express';
import { assert } from 'ts-essentials';
import { OnBoardingService, validateAccount } from './service';
import {
  AccountNonValidError,
  AccountNotFoundError,
  ValidationError,
} from './errors';

const logger = global.LOGGER('OnboardingRouter');

const router = express.Router();

router.get('/eligible-addresses', async (req, res) => {
  try {
    const blockNumber = !!req.query.blockNumber
      ? +req.query.blockNumber
      : undefined;

    if (!!blockNumber && isNaN(blockNumber))
      throw new ValidationError(
        'blockNumber should be either undefined or a number',
      );

    const addresses =
      await OnBoardingService.getInstance().getEligibleAddresses(blockNumber);

    return res.json(addresses);
  } catch (e) {
    logger.error(req.path, e);
    res.status(403).send({
      error:
        e instanceof ValidationError
          ? e.message
          : `onboarding: could not retrieve list of addressees`,
    });
  }
});

router.get('/check-eligibility/:address/:blockNumber', async (req, res) => {
  try {
    const address = req.params.address;
    const blockNumber = +req.params.blockNumber;

    if (address.length !== 42 || !address.startsWith('0x'))
      throw new ValidationError('pass an address as first param');
    if (isNaN(blockNumber))
      throw new ValidationError('pass a block number as second param');

    const isEligible = await OnBoardingService.getInstance().isAddressEligible(
      address,
      blockNumber,
    );

    return res.json({ isEligible });
  } catch (e) {
    logger.error(req.path, e);
    res.status(403).send({
      error:
        e instanceof ValidationError
          ? e.message
          : `onboarding: could not check eligibility`,
    });
  }
});

router.post('/submit-verified', async (req, res) => {
  try {
    assert(
      process.env.SUBMIT_ACCOUNT_API_KEY,
      'set SUBMIT_ACCOUNT_API_KEY env var',
    );

    if (req.headers['x-auth-token'] !== process.env.SUBMIT_ACCOUNT_API_KEY)
      return res.status(401).send({ error: 'wrong token' });

    const account = req.body;

    if (!validateAccount(account)) throw new AccountNonValidError(account);

    await OnBoardingService.getInstance().submitVerifiedAccount(account);

    return res.status(201).send('Ok');
  } catch (e) {
    logger.error(req.path, e);
    res.status(403).send({
      error: e.message,
    });
  }
});

router.post('/waiting-list', async (req, res) => {
  try {
    const account = req.body;

    if (!validateAccount(account)) throw new AccountNonValidError(account);

    const registeredAccount =
      await OnBoardingService.getInstance().submitAccountForWaitingList(
        account,
      );

    return res.json(registeredAccount);
  } catch (e) {
    logger.error(req.path, e);
    res.status(403).send({
      error:
        e instanceof ValidationError ? e.message : `Error creating account`,
    });
  }
});

router.get('/waiting-list/:uuid', async (req, res) => {
  try {
    const uuid = req.params.uuid;

    const registeredAccount =
      await OnBoardingService.getInstance().getAccountByUUID(uuid);

    return res.json(registeredAccount);
  } catch (e) {
    logger.error(req.path, e);

    res.status(e instanceof AccountNotFoundError ? 404 : 403).send({
      error: e.message,
    });
  }
});

export default router;
