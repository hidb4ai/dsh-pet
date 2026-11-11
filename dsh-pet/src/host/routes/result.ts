/**
 * There are two conclusions for the route response: business failure is always 200, protocol failure retains the real
 * status code, and the body is always the same entity.
 *
 * The judgment after "the request has entered the processor" (missing parameters, unknown pet, occupied, generation
 * failure) is the business conclusion, use {@link failResult} ; the request has not entered the business (the method
 * is wrong, JSON is broken, the body exceeds the limit) use a protocol constructor such as {@link methodNotAllowed} .
 * Do not judge the business or parse the input: just wrap reason and the copy into RouteResult, and the status code is
 * determined by the conclusion type.
 * @module dsh-pet/src/host/routes/result
 */
import type { RouteResult } from '../http.ts';

/**
 * Failure reason (wire vocabulary): The respective narrow unions of the domain layer must be assignable here. The new
 * value is equivalent to the interface change - the consumer presses the reason branch, and if the processing is
 * missed, the missed branch will be obtained.
 */
export type ResultReason =
  | 'bad-request'
  | 'generate-error'
  | 'internal-error'
  | 'invalid-json'
  | 'invalid-label'
  | 'invalid-labels'
  | 'invalid-owner'
  | 'invalid-target'
  | 'lock-lost'
  | 'lock-required'
  | 'locked'
  | 'method-not-allowed'
  | 'no-sleep-animations'
  | 'payload-too-large'
  | 'pet-not-displayed'
  | 'pet-required'
  | 'pose-unavailable'
  | 'provider-missing'
  | 'sleeping'
  | 'todo-not-found'
  | 'too-many-items'
  | 'too-many-owners'
  | 'unknown-animation'
  | 'unknown-entry'
  | 'unknown-image'
  | 'unknown-owner'
  | 'unknown-pet'
  | 'unknown-playback'
  | 'unsupported'
  | 'user-config-unparsable'
  | 'voice-busy';

/** Failed entity: status code does not participate in judgment, 200 and 4 xx share this shape. */
export interface FailureEntity {
  readonly ok: false;
  readonly reason: ResultReason;
  readonly message: string;
}

/**
 * Failed to construct entity.
 *
 * @param reason - Reason for failure, determined by the processor, inference from status code is not accepted.
 * @param message - Instructions for people to read.
 * @param extra - additional fields (such as `cause` , `needConfirm` ); cannot override `ok` / `reason` / `message` .
 */
export function failureBody(reason: ResultReason, message: string, extra?: Record<string, unknown>): FailureEntity {
  return { ...extra, ok: false, reason, message } as FailureEntity;
}

/** Successful response: status code 200, the response body is the result itself (not including a layer of data). */
export function okResult(obj: unknown = {}, headers?: Record<string, string>): RouteResult {
  return { kind: 'json', status: 200, obj, headers };
}

/**
 * Business failure: The request has entered the processor and a conclusion has been given, always 200 + failed
 * entities.
 *
 * @param reason - Reason for failure, determined by the processor, inference from status code is not accepted.
 * @param message - Instructions for people to read.
 * @param extra - additional fields (such as `cause` , `needConfirm` ); cannot override `ok` / `reason` / `message` .
 */
export function failResult(reason: ResultReason, message: string, extra?: Record<string, unknown>): RouteResult {
  return { kind: 'json', status: 200, obj: failureBody(reason, message, extra) };
}

/** The request body is not valid JSON: 400. */
export function invalidJson(message = 'invalid JSON body'): RouteResult {
  return rejected(400, 'invalid-json', message);
}

/** This method is not accepted for this path: 405. */
export function methodNotAllowed(message = 'method not allowed'): RouteResult {
  return rejected(405, 'method-not-allowed', message);
}

/** The request body exceeds the upper limit: 413. */
export function payloadTooLarge(message = 'request body too large'): RouteResult {
  return rejected(413, 'payload-too-large', message);
}

/** Unexpected exception: 500. The text is fixed, only the true reasons are entered in the log, and the path and internal details are not leaked. */
export function internalError(): RouteResult {
  return rejected(500, 'internal-error', 'dsh-pet: internal error');
}

/** Protocol failure: real status code + body with the same shape as business failure. */
function rejected(status: number, reason: ResultReason, message: string): RouteResult {
  return { kind: 'json', status, obj: failureBody(reason, message) };
}
