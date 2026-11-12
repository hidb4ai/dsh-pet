/** Optional robot control contract; all operations are explicit operator requests. */
import { ZodError } from 'zod';
import { readAllConfig } from '../config.ts';
import { robotRequestSchema } from '../robot/config.ts';
import type { RouteHandler } from './types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';

/** Read cached status or submit one validated control operation. */
export const handleRobotRoutes: RouteHandler = async (deps, { rest, method, body }) => {
  if (rest !== 'robot') return;
  if (method !== 'GET' && method !== 'POST') return methodNotAllowed();
  if (!deps.robot) return failResult('unsupported', 'robot_unavailable');
  try {
    if (method === 'POST') {
      const request = robotRequestSchema.parse(JSON.parse(body ?? 'null'));
      if ('petId' in request) {
        const pet = deps.requirePet(new URLSearchParams({ pet: request.petId }), () => readAllConfig(deps.configPaths));
        if (!pet.ok) return pet.res;
      }
      return okResult({ ok: true, ...(await deps.robot.submit(request)) });
    }
    return okResult({ ok: true, ...deps.robot.snapshot() });
  } catch (error) {
    if (error instanceof SyntaxError) return invalidJson();
    return failResult(
      'bad-request',
      error instanceof ZodError
        ? 'robot_invalid_request'
        : error instanceof Error && /^robot_[a-z_]+$/.test(error.message)
          ? error.message
          : 'robot_failed',
    );
  }
};
