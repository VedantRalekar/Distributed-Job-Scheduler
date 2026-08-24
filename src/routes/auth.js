import { Router } from 'express';
import { z } from 'zod';

import {
  asyncHandler
} from '../utils/asyncHandler.js';

import {
  validate
} from '../middleware/validate.js';

import {
  register,
  login
} from '../services/auth.service.js';

const router = Router();

const registerSchema =
  z.object({
    email: z.string().email(),

    password:
      z.string().min(8),

    displayName:
      z.string()
        .min(2)
        .max(120),

    organizationName:
      z.string()
        .min(2)
        .max(200)
  });

const loginSchema =
  z.object({
    email:
      z.string().email(),

    password:
      z.string().min(8)
  });

router.post(
  '/register',
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({
      success: true,
      data: await register(req.body)
    });
  })
);

router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: await login(req.body)
    });
  })
);

export default router;