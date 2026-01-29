import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';

export const authRoutes = Router();

// POST /api/v1/auth/login - Handled by Cognito hosted UI or API
authRoutes.post('/login', async (_req: Request, res: Response, _next: NextFunction) => {
  // Authentication is handled by AWS Cognito
  // This endpoint can be used for custom login flows if needed
  res.json({
    success: true,
    message: 'Use Cognito hosted UI or SDK for authentication',
  });
});

// POST /api/v1/auth/refresh - Refresh access token
authRoutes.post('/refresh', async (_req: Request, res: Response, _next: NextFunction) => {
  // Token refresh is handled by Cognito SDK on the frontend
  res.json({
    success: true,
    message: 'Use Cognito SDK for token refresh',
  });
});

// POST /api/v1/auth/logout
authRoutes.post('/logout', async (_req: Request, res: Response, _next: NextFunction) => {
  // Logout is handled by Cognito - invalidate tokens on client
  res.json({ success: true, message: 'Logged out successfully' });
});
