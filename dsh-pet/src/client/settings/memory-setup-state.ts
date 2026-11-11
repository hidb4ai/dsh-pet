/**
 * 本机记忆状态轮询与操作：迟到请求不能覆盖新操作，卸载时终止请求。
 * 配置回调只传记忆绑定，模型密钥不进入状态快照。
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { MemorySetupStatus } from '../../shared/memory-setup.ts';
import type { SettingsRuntime } from './runtime.ts';

/** 与设置容器同步操作状态和已保存的记忆字段。 */
export interface MemorySetupCallbacks {
  onBusy(busy: boolean): void;
  onBinding(binding: NonNullable<MemorySetupStatus['binding']>): void;
}

/** 操作成功后持续轮询，读写失败保留错误并允许重新连接。 */
export function useMemorySetup(rt: SettingsRuntime, callbacks: MemorySetupCallbacks) {
  const { useState, useRef, useEffect } = rt;
  const [status, setStatus] = useState<MemorySetupStatus | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const notify = useRef(callbacks);
  notify.current = callbacks;
  const binding = useRef('');
  const request = useRef<(body?: unknown) => Promise<boolean>>(async () => false);
  useEffect(() => {
    let disposed = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    request.current = async (body) => {
      clearTimeout(timer);
      controller?.abort();
      const active = new AbortController();
      controller = active;
      if (body) {
        setPending(true);
        notify.current.onBusy(true);
      }
      try {
        const response = await fetch(ROUTE_PATH + '/powercontext/setup', {
          method: body ? 'POST' : 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.any([active.signal, AbortSignal.timeout(10_000)]),
        });
        const data = (await response.json()) as MemorySetupStatus & { ok?: boolean; message?: string };
        if (!response.ok || data.ok !== true || typeof data.available !== 'boolean')
          throw new Error(data.message ?? 'setup_failed');
        if (disposed || active.signal.aborted) return false;
        setStatus(data);
        setError('');
        notify.current.onBusy(data.busy === true);
        if (data.binding && JSON.stringify(data.binding) !== binding.current) {
          binding.current = JSON.stringify(data.binding);
          notify.current.onBinding(data.binding);
        }
        return true;
      } catch (cause) {
        if (!disposed && !active.signal.aborted) setError(cause instanceof Error ? cause.message : 'setup_failed');
        return false;
      } finally {
        if (!disposed && !active.signal.aborted) {
          setPending(false);
          timer = setTimeout(() => void request.current(), 2000);
        }
      }
    };
    void request.current();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      notify.current.onBusy(false);
    };
  }, []);
  return { status, error, pending, send: (body?: unknown) => request.current(body) };
}
