import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { HttpError } from '../utils/httpError.js';

export function authenticate(req, _res, next) {
  try {
    const header =
      req.headers.authorization || '';

    const token =
      header.startsWith('Bearer ')
        ? header.slice(7)
        : null;

    if (!token) {
      throw new HttpError(
        401,
        'Authentication required'
      );
    }

    req.user = jwt.verify(
      token,
      config.jwtSecret
    );

    next();
  } catch (error) {
    next(
      error instanceof HttpError
        ? error
        : new HttpError(
            401,
            'Invalid or expired token'
          )
    );
  }
}

export function requireRole(...allowedRoles) {
  return async (req, _res, next) => {
    try {
      const organizationId =
        req.params.organizationId ||
        req.body.organizationId ||
        req.query.organizationId;

      if (!organizationId) {
        throw new HttpError(
          400,
          'organizationId is required'
        );
      }

      const { rows } = await query(
        `
        SELECT role
        FROM organization_members
        WHERE organization_id = $1
        AND user_id = $2
        `,
        [
          organizationId,
          req.user.sub
        ]
      );

      if (!rows[0]) {
        throw new HttpError(
          403,
          'Not a member of this organization'
        );
      }

      if (!allowedRoles.includes(rows[0].role)) {
        throw new HttpError(
          403,
          'Insufficient permissions'
        );
      }

      req.role = rows[0].role;

      next();
    } catch (error) {
      next(error);
    }
  };
}