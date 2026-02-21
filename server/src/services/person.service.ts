import type { PersonWithId, TreeNode, SearchResult } from '@fsf/shared';
import { databaseService } from './database.service.js';

export const personService = {
  async listPersons(dbId: string, page: number, limit: number): Promise<SearchResult> {
    // Use the database service which handles SQLite with canonical IDs
    const { persons, total } = await databaseService.listPersons(dbId, { page, limit });
    const totalPages = Math.ceil(total / limit);

    return { results: persons, total, page, limit, totalPages };
  },

  async getPerson(dbId: string, personId: string): Promise<PersonWithId | null> {
    // Use the database service which handles SQLite with canonical IDs
    return databaseService.getPerson(dbId, personId);
  },

  async getPersonTree(
    dbId: string,
    personId: string,
    depth: number,
    direction: 'ancestors' | 'descendants'
  ): Promise<TreeNode | null> {
    // Cache for loaded persons to avoid repeated lookups
    const personCache = new Map<string, PersonWithId>();

    const loadPerson = async (id: string): Promise<PersonWithId | null> => {
      if (personCache.has(id)) {
        return personCache.get(id)!;
      }
      const person = await databaseService.getPerson(dbId, id);
      if (person) {
        personCache.set(id, person);
        personCache.set(person.id, person); // Also cache by canonical ID
      }
      return person;
    };

    const person = await loadPerson(personId);
    if (!person) return null;

    const buildTree = async (id: string, currentDepth: number): Promise<TreeNode> => {
      const p = await loadPerson(id);
      if (!p) {
        return { id, name: 'Unknown', lifespan: '' };
      }

      const node: TreeNode = {
        id: p.id, // Use canonical ID from the loaded person
        name: p.name,
        lifespan: p.lifespan,
        location: p.location,
        occupation: p.occupation
      };

      if (currentDepth < depth) {
        const childIds = direction === 'ancestors' ? p.parents : p.children;
        if (childIds && childIds.length > 0) {
          const children: TreeNode[] = [];
          for (const childId of childIds) {
            if (!childId) continue;
            const childNode = await buildTree(childId, currentDepth + 1);
            if (childNode) {
              children.push(childNode);
            }
          }
          if (children.length > 0) {
            node.children = children;
          }
        }
      } else if (currentDepth === depth) {
        // Mark as collapsed if there are more
        const childIds = direction === 'ancestors' ? p.parents : p.children;
        if (childIds && childIds.length > 0) {
          node._collapsed = true;
        }
      }

      return node;
    };

    return buildTree(personId, 0);
  }
};
