/** Poll cached robot state; operator requests are never retried automatically. */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { RobotSnapshot } from '../../shared/robot.ts';
import type { ChatPanelRuntime } from '../chat/runtime.ts';
import type { RobotKey } from './locales.ts';

/** Host-injected React and locale capabilities, also used by standalone chat. */
export type RobotRuntime = Omit<ChatPanelRuntime, 'ui' | 't'> & { t: (key: RobotKey) => string };

/** Generate a request identity even on local HTTP hosts without randomUUID support. */
export function robotRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Keep failed requests visible while independent polling discovers their actual receipts. */
export function useRobotState(rt: RobotRuntime) {
  const { useState, useRef, useEffect } = rt;
  const [snapshot, setSnapshot] = useState<RobotSnapshot | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const sendRef = useRef<(body?: unknown) => Promise<boolean>>(async () => false);
  useEffect(() => {
    let disposed = false;
    let sequence = 0;
    let writes = 0;
    const controllers = new Set<AbortController>();
    const send = async (body?: unknown): Promise<boolean> => {
      const revision = ++sequence;
      const controller = new AbortController();
      controllers.add(controller);
      if (body) {
        writes++;
        setPending(true);
        setError('');
      }
      try {
        const response = await fetch(ROUTE_PATH + '/robot', {
          method: body ? 'POST' : 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        const result = (await response.json()) as RobotSnapshot & { ok?: boolean; message?: string };
        if (
          !response.ok ||
          result.ok !== true ||
          !result.config ||
          !Array.isArray(result.config.actions) ||
          !Array.isArray(result.commands) ||
          typeof result.session !== 'string'
        )
          throw new Error(result.message || 'robot_request_failed');
        if (!disposed && revision === sequence) setSnapshot(result);
        return true;
      } catch (cause) {
        if (!disposed && !controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'robot_request_failed');
        return false;
      } finally {
        controllers.delete(controller);
        if (body) writes--;
        if (!disposed) setPending(writes > 0);
      }
    };
    sendRef.current = send;
    void send();
    const timer = setInterval(() => {
      if (controllers.size === 0) void send();
    }, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
      for (const controller of controllers) controller.abort();
    };
  }, []);
  return { snapshot, error, pending, send: (body?: unknown) => sendRef.current(body) };
}
