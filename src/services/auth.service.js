import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import {
  query,
  transaction
} from '../db.js';

import { config } from '../config.js';
import { HttpError } from '../utils/httpError.js';

function tokenFor(
  user,
  organizationId,
  role
) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      organizationId,
      role
    },
    config.jwtSecret,
    {
      expiresIn:
        config.jwtExpiresIn
    }
  );
}

export async function register({
  email,
  password,
  displayName,
  organizationName
}) {
  const existing =
    await query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

  if (existing.rowCount) {
    throw new HttpError(
      409,
      'Email already registered'
    );
  }

  const passwordHash =
    await bcrypt.hash(password, 12);

  return transaction(
    async client => {
      const user =
        (
          await client.query(
            `
            INSERT INTO users(
              email,
              display_name,
              password_hash
            )
            VALUES($1,$2,$3)
            RETURNING
              id,
              email,
              display_name,
              created_at
            `,
            [
              email,
              displayName,
              passwordHash
            ]
          )
        ).rows[0];

      const organization =
        (
          await client.query(
            `
            INSERT INTO organizations(name)
            VALUES($1)
            RETURNING id,name
            `,
            [organizationName]
          )
        ).rows[0];

      await client.query(
        `
        INSERT INTO organization_members(
          organization_id,
          user_id,
          role
        )
        VALUES($1,$2,'ADMIN')
        `,
        [
          organization.id,
          user.id
        ]
      );

      return {
        user,
        organization,
        role: 'ADMIN',
        token: tokenFor(
          user,
          organization.id,
          'ADMIN'
        )
      };
    }
  );
}

export async function login({
  email,
  password
}) {
  const { rows } =
    await query(
      `
      SELECT
        u.*,
        om.organization_id,
        om.role
      FROM users u
      JOIN organization_members om
        ON om.user_id = u.id
      WHERE u.email = $1
      ORDER BY om.created_at
      LIMIT 1
      `,
      [email]
    );

  const user = rows[0];

  if (
    !user ||
    !(await bcrypt.compare(
      password,
      user.password_hash
    ))
  ) {
    throw new HttpError(
      401,
      'Invalid email or password'
    );
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName:
        user.display_name
    },

    organizationId:
      user.organization_id,

    role: user.role,

    token: tokenFor(
      user,
      user.organization_id,
      user.role
    )
  };
}