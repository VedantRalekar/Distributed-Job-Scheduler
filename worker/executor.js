export async function executePayload(
  payload,
  { log }
) {
  const type =
    payload.type || 'echo';

  if (type === 'echo') {
    await log(
      'INFO',
      String(
        payload.message ??
        payload.data ??
        ''
      )
    );

    return {
      result:
        payload.message ??
        payload.data ??
        null
    };
  }

  if (type === 'sleep') {
    const ms =
      Math.min(
        Math.max(
          Number(
            payload.ms || 100
          ),
          0
        ),
        30000
      );

    await log(
      'INFO',
      `Sleeping for ${ms}ms`
    );

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          ms
        )
    );

    return {
      sleptMs: ms
    };
  }

  if (type === 'sum') {
    const values =
      Array.isArray(
        payload.values
      )
        ? payload.values.map(Number)
        : [];

    if (
      !values.length ||
      values.some(
        Number.isNaN
      )
    ) {
      throw new Error(
        'sum requires numeric values'
      );
    }

    const result =
      values.reduce(
        (a, b) => a + b,
        0
      );

    await log(
      'INFO',
      `Computed sum=${result}`
    );

    return {
      result
    };
  }

  if (type === 'fail') {
    await log(
      'ERROR',
      payload.message ||
        'Intentional failure'
    );

    throw new Error(
      payload.message ||
        'Intentional failure'
    );
  }

  throw new Error(
    `Unsupported job type: ${type}`
  );
}