/**
 * Types for graph traversal algorithms
 */

export interface GraphPerson {
  name: string;
  lifespan: string;
  location?: string;
  parents: (string | null)[];
  children: string[];
  occupation?: string;
  bio?: string;
}

export interface Graph {
  [id: string]: GraphPerson;
}
