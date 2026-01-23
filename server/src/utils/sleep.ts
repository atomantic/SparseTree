/**
 * Promise-based sleep utility
 * @param delay - milliseconds to wait
 */
export const sleep = (delay: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delay));

export default sleep;
