/** Select a random item from a list, or return undefined when it is empty. */
export const randomElement = <T>(items: readonly T[]): T | undefined => {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
};
