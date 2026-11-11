/**
 * Desktop Helper is an input type shared by three sub-modules to avoid import forming a ring with each other.
 *
 * Only the dependent shape is declared, without implementation; the field semantics are shown in each usage.
 * @module dsh-pet/src/host/plugin/desktop/types
 */
import type { BalancePoll } from '../balance-poll.ts';
import type { DownloadReport } from '../download-report.ts';
import type { HostSetup } from '../setup.ts';
import type { HostContext } from '../context.ts';
import type { RouteResult } from '../../http.ts';

/** Input for desktop Helper lifecycle. */
export type DesktopHelperDeps = Pick<HostSetup, 'configPaths' | 'log' | 'thumbUserRoot'> &
  Pick<BalancePoll, 'effectivePetList'> &
  Pick<DownloadReport, 'reportDownload'> & {
    /** host context (the one apply received). */
    ctx: HostContext;
    /**
     * route processor (lazy access): Helper needs to forward the request when it starts, so what is taken here is the
     * promise of "the processor can be obtained later", not the processor itself - otherwise it and route assembly
     * will form a construction cycle.
     */
    getHandlePetRoute: () => (url: string, method: string, body?: string, signal?: AbortSignal) => Promise<RouteResult>;
  };
