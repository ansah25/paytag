import { RequestHandler } from 'express';
import { z } from 'zod';
import {
  USERNAME_REGEX,
  RESERVED_USERNAMES,
  normalizeUsername,
  isUsernameAvailable,
  generateSuggestions,
} from '../services/userService';

export const availabilityParamsSchema = z.object({
  username: z.string().min(1),
});

export const checkAvailability: RequestHandler = async (req, res, next) => {
  try {
    const { username } = req.params as z.infer<typeof availabilityParamsSchema>;
    const normalized = normalizeUsername(username);

    if (!USERNAME_REGEX.test(normalized)) {
      res.json({
        available: false,
        reason: 'INVALID_FORMAT',
        suggestions: [],
      });
      return;
    }

    if (RESERVED_USERNAMES.has(normalized)) {
      res.json({
        available: false,
        reason: 'RESERVED',
        suggestions: await generateSuggestions(normalized),
      });
      return;
    }

    const available = await isUsernameAvailable(normalized);
    if (available) {
      res.json({ available: true, suggestions: [] });
      return;
    }

    res.json({
      available: false,
      reason: 'TAKEN',
      suggestions: await generateSuggestions(normalized),
    });
  } catch (err) {
    next(err);
  }
};
