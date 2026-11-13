/** Validate operator configuration and persist it outside the installed package. */
import { basename } from 'node:path';
import { z } from 'zod';
import type { RobotConfig } from '../../shared/robot.ts';

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const address = z
  .string()
  .max(255)
  .refine((value) => {
    if (!value) return true;
    const match = /^([a-zA-Z0-9.-]+):(\d{1,5})$/.exec(value);
    return !!match && Number(match[2]) > 0 && Number(match[2]) <= 65535;
  }, 'Expected a robot hostname:port');

/** Configuration schema; action IDs always come from the operator's allowlist. */
export const robotConfigSchema = z
  .strictObject({
    enabled: z.boolean(),
    address,
    python: z
      .string()
      .min(1)
      .max(1024)
      .refine(
        (value) =>
          value === 'bundled' ||
          (!/[\r\n\0]/.test(value) &&
            /^python(?:\d+(?:\.\d+)*)?(?:\.exe)?$/i.test(basename(value.replace(/\\/g, '/')))),
      ),
    timeoutSeconds: z.number().int().min(3).max(120),
    petId: z.string().min(1).max(128),
    actions: z
      .array(
        z.strictObject({
          key: identifier,
          name: z.string().trim().min(1).max(80),
          actionIds: z.array(z.number().int().min(0).max(2_147_483_647)).min(1).max(32),
          petAnimation: z.string().max(128),
        }),
      )
      .max(20),
  })
  .refine((config) => !config.enabled || !!config.address, 'A robot address is required')
  .refine(
    (config) => new Set(config.actions.map((action) => action.key)).size === config.actions.length,
    'Action keys must be unique',
  )
  .refine(
    (config) => Buffer.byteLength(JSON.stringify(config, null, 2) + '\n') <= 30_000,
    'Robot configuration exceeds the private storage limit',
  );

/** Start with monitoring and all motion disabled. */
export function defaultRobotConfig(): RobotConfig {
  return {
    enabled: false,
    address: '',
    python: 'bundled',
    timeoutSeconds: 30,
    petId: 'main',
    actions: [],
  };
}

/** Requests never accept joint coordinates, arbitrary RPC names or system commands. */
export const robotRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('configure'), config: robotConfigSchema }),
  z.strictObject({ action: z.literal('check') }),
  z.strictObject({ action: z.literal('arm'), session: z.string().uuid(), confirmed: z.literal(true) }),
  z.strictObject({ action: z.literal('disarm') }),
  z.strictObject({ action: z.literal('stop') }),
  z.strictObject({
    action: z.literal('execute'),
    session: z.string().uuid(),
    id: z.string().uuid(),
    key: identifier,
    petId: z.string().min(1).max(128),
    confirmed: z.literal(true),
  }),
  z.strictObject({
    action: z.literal('speak'),
    session: z.string().uuid(),
    id: z.string().uuid(),
    text: z.string().trim().min(1).max(500),
    petId: z.string().min(1).max(128),
    confirmed: z.literal(true),
  }),
]);

/** Validated operation accepted by the controller. */
export type RobotRequest = z.infer<typeof robotRequestSchema>;
