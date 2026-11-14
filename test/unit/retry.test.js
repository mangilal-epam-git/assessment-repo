import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBackoffMillis,
  withRetry,
  sleep,
  RetryableError,
  DEFAULT_RETRY_POLICY,
} from '../../src/best-offers/retry.js';

/** Deterministic policy: random() fixed, so jitter is predictable. */
function policy(overrides = {}) {
  return {
    maxAttempts: 3,
    initialDelayMillis: 10,
    maxDelayMillis: 100,
    backoffMultiplier: 2,
    totalBudgetMillis: 5000,
    random: () => 1,
    ...overrides,
  };
}

test('the first attempt has no backoff', () => {
  assert.equal(computeBackoffMillis(1, policy()), 0);
  assert.equal(computeBackoffMillis(0, policy()), 0);
});

test('backoff grows exponentially and is capped', () => {
  const p = policy({ initialDelayMillis: 100, maxDelayMillis: 1000, random: () => 1 });
  assert.equal(computeBackoffMillis(2, p), 100);
  assert.equal(computeBackoffMillis(3, p), 200);
  assert.equal(computeBackoffMillis(4, p), 400);
  assert.equal(computeBackoffMillis(6, p), 1000, 'capped at maxDelayMillis');
  assert.equal(computeBackoffMillis(9, p), 1000);
});

test('full jitter draws uniformly below the capped delay', () => {
  const p = policy({ initialDelayMillis: 100, maxDelayMillis: 1000 });
  assert.equal(computeBackoffMillis(3, { ...p, random: () => 0 }), 0);
  assert.equal(computeBackoffMillis(3, { ...p, random: () => 0.5 }), 100);
  assert.equal(computeBackoffMillis(3, { ...p, random: () => 0.999 }), 199);
});

test('the default policy is conservative and bounded', () => {
  assert.equal(DEFAULT_RETRY_POLICY.maxAttempts, 3);
  assert.ok(DEFAULT_RETRY_POLICY.totalBudgetMillis <= 10_000);
  assert.ok(Object.isFrozen(DEFAULT_RETRY_POLICY));
});

test('returns the first successful result without retrying', async () => {
  let calls = 0;
  const value = await withRetry(
    async () => {
      calls += 1;
      return 'ok';
    },
    { policy: policy() },
  );
  assert.equal(value, 'ok');
  assert.equal(calls, 1);
});

test('retries a retryable failure and eventually succeeds', async () => {
  let calls = 0;
  const retries = [];
  const value = await withRetry(
    async ({ attempt }) => {
      calls += 1;
      if (attempt < 3) throw new RetryableError('TIMEOUT', 'upstream timed out');
      return 'recovered';
    },
    { policy: policy({ initialDelayMillis: 1, maxDelayMillis: 2 }), onRetry: (e) => retries.push(e) },
  );
  assert.equal(value, 'recovered');
  assert.equal(calls, 3);
  assert.equal(retries.length, 2);
  assert.deepEqual(retries.map((r) => r.attempt), [1, 2]);
  assert.equal(retries[0].code, 'TIMEOUT');
});

test('does not retry an error marked non-retryable', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw new RetryableError('INVALID_JSON', 'bad body', { retryable: false });
        },
        { policy: policy({ initialDelayMillis: 0 }) },
      ),
    /bad body/,
  );
  assert.equal(calls, 1, 'a permanently broken response must not be retried');
});

test('does not retry a plain error', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw new TypeError('programming error');
        },
        { policy: policy() },
      ),
    TypeError,
  );
  assert.equal(calls, 1);
});

test('stops at maxAttempts and rethrows the last error', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw new RetryableError('NETWORK_ERROR', `attempt ${calls}`);
        },
        { policy: policy({ maxAttempts: 4, initialDelayMillis: 1, maxDelayMillis: 1 }) },
      ),
    /attempt 4/,
  );
  assert.equal(calls, 4);
});

test('stops early when the total budget would be exceeded', async () => {
  let calls = 0;
  let fakeNow = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          fakeNow += 400; // each attempt burns 400ms of the budget
          throw new RetryableError('TIMEOUT', 'slow');
        },
        {
          policy: policy({ maxAttempts: 10, initialDelayMillis: 200, maxDelayMillis: 200, totalBudgetMillis: 1000 }),
          monotonicNow: () => fakeNow,
        },
      ),
    /slow/,
  );
  // 400 + 200 = 600 < 1000 so a second attempt runs; after it elapsed is 800
  // and 800 + 200 >= 1000, so the third is not attempted.
  assert.equal(calls, 2);
});

test('honours a Retry-After hint over computed backoff', async () => {
  const retries = [];
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          throw new RetryableError('HTTP_STATUS', 'throttled', { retryAfterMillis: 5 });
        },
        { policy: policy({ maxAttempts: 2, maxDelayMillis: 1000 }), onRetry: (e) => retries.push(e) },
      ),
    /throttled/,
  );
  assert.equal(retries[0].delayMillis, 5);
});

test('a Retry-After hint overrides computed backoff, not the total budget', async () => {
  // The provider's own guidance is better information than our backoff curve,
  // so it is honoured as given rather than clamped to maxDelayMillis...
  const retries = [];
  let fakeNow = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          throw new RetryableError('HTTP_STATUS', 'throttled', { retryAfterMillis: 5000 });
        },
        {
          policy: policy({ maxAttempts: 3, maxDelayMillis: 3, totalBudgetMillis: 50_000 }),
          onRetry: (e) => retries.push(e),
          monotonicNow: () => fakeNow,
        },
      ),
    /throttled/,
  );
  assert.equal(retries[0].delayMillis, 5000, 'honoured in full, not clamped to maxDelayMillis');

  // ...but the budget still refuses a wait it cannot afford.
  const budgeted = [];
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          throw new RetryableError('HTTP_STATUS', 'throttled', { retryAfterMillis: 5000 });
        },
        {
          policy: policy({ maxAttempts: 3, maxDelayMillis: 10_000, totalBudgetMillis: 1000 }),
          onRetry: (e) => budgeted.push(e),
        },
      ),
    /throttled/,
  );
  assert.equal(budgeted.length, 0, 'a 5s wait does not fit in a 1s budget, so no retry');
});

test('the total budget is a deadline that charges attempt duration, not just sleeps', async () => {
  // Each attempt burns 400ms of a 1000ms budget with no backoff at all.
  // Without charging attempt time, this would run all five attempts.
  let calls = 0;
  let fakeNow = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          fakeNow += 400;
          throw new RetryableError('TIMEOUT', 'slow');
        },
        {
          policy: policy({ maxAttempts: 5, initialDelayMillis: 0, maxDelayMillis: 0, totalBudgetMillis: 1000 }),
          monotonicNow: () => fakeNow,
        },
      ),
    /slow/,
  );
  assert.equal(calls, 3, 'attempts at t=0, 400 and 800; t=1200 exceeds the budget');
});

test('the first attempt always runs, even with an impossibly small budget', async () => {
  let calls = 0;
  const value = await withRetry(
    async () => {
      calls += 1;
      return 'ok';
    },
    { policy: policy({ totalBudgetMillis: 1 }) },
  );
  assert.equal(value, 'ok');
  assert.equal(calls, 1);
});

test('a policy with no attempts is a programming error, not a silent no-op', async () => {
  await assert.rejects(
    () => withRetry(async () => 'never', { policy: policy({ maxAttempts: 0 }) }),
    RangeError,
  );
});

test('aborts promptly when the signal fires before the first attempt', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled upfront'));
  await assert.rejects(
    () => withRetry(async () => 'never', { policy: policy(), signal: controller.signal }),
    /cancelled upfront/,
  );
});

test('aborts during a backoff nap', async () => {
  const controller = new AbortController();
  const started = Date.now();
  const promise = withRetry(
    async () => {
      throw new RetryableError('TIMEOUT', 'slow');
    },
    {
      policy: policy({ maxAttempts: 5, initialDelayMillis: 5000, maxDelayMillis: 5000, totalBudgetMillis: 60_000 }),
      signal: controller.signal,
    },
  );
  setTimeout(() => controller.abort(new Error('cancelled mid-backoff')), 20);
  await assert.rejects(() => promise, /cancelled mid-backoff/);
  assert.ok(Date.now() - started < 2000, 'must not wait out the full backoff');
});

test('sleep resolves, and rejects when aborted', async () => {
  await sleep(0);
  await sleep(1);
  const controller = new AbortController();
  const promise = sleep(5000, controller.signal);
  controller.abort(new Error('stop'));
  await assert.rejects(() => promise, /stop/);

  const already = new AbortController();
  already.abort(new Error('already'));
  await assert.rejects(() => sleep(5000, already.signal), /already/);
});
