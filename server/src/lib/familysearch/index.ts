/**
 * FamilySearch API integration modules
 */

export { fsc } from './client.js';
export { fscget } from './fetcher.js';
export type { FetchError } from './fetcher.js';
// @ts-expect-error - Legacy JS module kept as JS due to complexity
export { json2person } from './transformer.js';
