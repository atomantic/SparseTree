/**
 * Find a random path between two nodes in a family tree graph
 */

import { randomElement } from './randomElement.js';
import type { Graph } from './types.js';
import { logger } from '../logger.js';

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
      logger.error('graph', `${testID} no person found`);
      return undefined;
    }
    path.push(testID);
    if (!person.children || !person.children.length) {
      logger.error('graph', `${testID} no children`);
      return undefined;
    }
    testID = randomElement(person.children)!;
  }
  path.push(testID);

  return path;
};

export default pathRandom;
