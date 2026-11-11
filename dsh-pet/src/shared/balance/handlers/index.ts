/**
 * The distribution table from form to display rule is also the only entry point for balance display distribution by
 * form.
 *
 * Deliberately written as `Record<BalanceShape, ShapeHandler>` instead of several if/switch: When adding a shape to
 * BalanceShape but forgetting to add handler, the type check will directly report the missing attribute instead of
 * silently going to another branch.
 *
 * @module dsh-pet/src/shared/balance/handlers/index
 */

import type { BalanceShape } from '../types.ts';
import { customHandler } from './custom.ts';
import { moneyHandler } from './money.ts';
import { pointsHandler } from './points.ts';
import type { ShapeHandler } from './shape.ts';
import { windowsHandler } from './windows.ts';

/** Display rules for each form; new forms must be completed here, otherwise the type check will report an error. */
export const HANDLERS: Record<BalanceShape, ShapeHandler> = {
  windows: windowsHandler,
  money: moneyHandler,
  points: pointsHandler,
  custom: customHandler,
};
