import { z } from 'zod';
import { isValidIsoDate } from '../format';

/** ISO calendar date as stored in the database (yyyy-mm-dd, real day). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dato skal være åååå-mm-dd')
  .refine(isValidIsoDate, 'Ugyldig dato');

/** Whole øre within the range the app supports. */
export const oreAmount = (label: string) =>
  z.coerce
    .number({ error: `${label} skal være et tal` })
    .int(`${label} skal være hele øre`)
    .max(1e13, `${label} er for stort`)
    .min(-1e13, `${label} er for lille`);
