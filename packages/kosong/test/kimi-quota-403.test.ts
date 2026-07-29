import { describe, expect, it } from 'vitest';

import { APIProviderQuotaExhaustedError, isRetryableGenerateError } from '#/errors';
import { classifyKimiQuotaError } from '#/providers/kimi-errors';

/**
 * The kimi.com *subscription* (kimi-code) reports an exhausted plan quota with
 * HTTP 403 and its own wording, not the platform API's 429 + "exceeded your
 * current quota" body. Captured verbatim from a real exhausted account on
 * 2026-07-29; without this the failure classifies as `auth`, which is
 * indistinguishable from a bad key and hides every real quota stop.
 */
const SUBSCRIPTION_QUOTA_MESSAGE =
  "403 You've reached your usage limit for this billing cycle. Your quota will " +
  'be refreshed in the next cycle. To continue now, purchase extra usage or ' +
  'upgrade your plan: https://www.kimi.com/code/#pricing';

function subscriptionQuota403(): unknown {
  return { status: 403, message: SUBSCRIPTION_QUOTA_MESSAGE, headers: new Headers() };
}

describe('kimi subscription quota exhaustion (403)', () => {
  it('classifies the 403 billing-cycle body as quota-exhausted', () => {
    const result = classifyKimiQuotaError(subscriptionQuota403());
    expect(result).toBeInstanceOf(APIProviderQuotaExhaustedError);
    expect(isRetryableGenerateError(result)).toBe(false);
  });

  it('leaves an ordinary 403 alone', () => {
    expect(
      classifyKimiQuotaError({ status: 403, message: 'Forbidden: invalid api key' }),
    ).toBeUndefined();
  });

  it('still ignores a transient 429 throttle message', () => {
    expect(
      classifyKimiQuotaError({ status: 429, message: 'token quota per minute exceeded' }),
    ).toBeUndefined();
  });
});
