/** Attach the Astra controller to the plugin lifecycle and existing pet feedback routes. */
import { createRobotService, type RobotService } from '../robot/service.ts';
import { ROUTE_SEGMENT } from '../../shared/constants.ts';
import type { HostContext } from './context.ts';
import type { HttpRouteHandler } from './http-route.ts';

/** Keep robot feedback on the normal pet validation and lock-aware path. */
export function registerRobot(ctx: HostContext, userRoot: string, route: () => HttpRouteHandler): RobotService {
  const service = createRobotService({
    userRoot,
    async feedback(event) {
      const query = '?pet=' + encodeURIComponent(event.petId);
      await route()(ROUTE_SEGMENT + '/broadcast' + query, 'POST', JSON.stringify({ text: event.text, anim: false }));
      if (event.animation)
        await route()(ROUTE_SEGMENT + '/anim' + query, 'POST', JSON.stringify({ name: event.animation }));
    },
  });
  ctx.effect(() => () => service.dispose(), 'dsh-pet: Astra robot controller');
  return service;
}
