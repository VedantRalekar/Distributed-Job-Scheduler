import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';

export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    try {
      req[source] = schema.parse(req[source]);

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return next(
          new HttpError(
            400,
            'Validation failed',
            error.issues
          )
        );
      }

      next(error);
    }
  };
}