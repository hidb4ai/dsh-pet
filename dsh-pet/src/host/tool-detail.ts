/**
 * Public outlet for tool details copy: collapse a tool call into a sentence in a bubble.
 *
 * Only export again, the data is in ./tool-detail/copy and the analysis is in ./tool-detail/target. This must always
 * be true: bubble is the content on the screen, and parameter values will never appear.
 * @module dsh-pet/src/host/tool-detail
 */
export { toolDetailFromEvent } from './tool-detail/detail.ts';
