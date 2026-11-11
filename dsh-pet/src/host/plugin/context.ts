/**
 * The type of host context entry point: DSH injected by ctx does not have a complete service type that can be
 * statically merged.
 *
 * The ctx obtained by each factory passes through here, instead of writing a copy of `any` for each module - in this
 * way, "where to rely on the host service" only needs a type name of grep. In the future, when DSH provides a complete
 * Context merger, only this part will be changed. Do not expand the dependency area: the module still needs to declare
 * what it really uses through the HostPlugin input.
 * @module dsh-pet/src/host/plugin/context
 */

/**
 * host context (DSH injection).
 *
 * Although the peer type package can be parsed, it does not merge services such as webServer / commands / llm into
 * Context. Directly marking them as real types will only force each call point to be an assertion; controlled aliases
 * are retained here, which have the same conventions as `ctx: any` of apply.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Confine the untyped DSH context boundary to this module. */
export type HostContext = any;
/* eslint-enable @typescript-eslint/no-explicit-any */
