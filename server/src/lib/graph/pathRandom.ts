/**
 * Find a random path between two nodes in a family tree graph
 */

import sample from 'lodash.sample';
import type { Graph } from './types.js';

export const pathRandom = async (
  graph: Graph,
  source: string,
  target: string
): Promise<string[] | undefined> => {
  let testID = source;
  const path: string[] = [];

  while (testID !== target) {
    const person = graph[testID];
    if (!person) {
      console.error(testID, `no person found`);
      return undefined;
    }
    path.push(testID);
    if (!person.children || !person.children.length) {
      console.error('no children', testID);
      return undefined;
    }
    testID = sample(person.children)!;
  }
  path.push(testID);

  return path;
};

export default pathRandom;
