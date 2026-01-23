/**
 * Generate a random integer between min and max (inclusive)
 * @param min - minimum value (inclusive)
 * @param max - maximum value (inclusive)
 */
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

export default randInt;
