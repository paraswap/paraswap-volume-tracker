import * as express from 'express';
import { assert } from 'ts-essentials';
import {
  OnBoardingService,
  validateAccount,
  AccountNonValidError,
  AccountNotFoundError,
} from './service';

const router = express.Router();
const logger = global.LOGGER('OnboardingRouter');

router.get('/eligible-addresses', async (req, res) => {
  try {
    const addresses =
      await OnBoardingService.getInstance().getEligibleAddresses();

    return res.json(addresses);
  } catch (e) {
    logger.error(req.path, JSON.stringify({ msg: e.message, stack: e.stack }));
    res.status(403).send({
      error: `onboarding: could not retrieve list of addressees`,
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
      error: e.message,
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
