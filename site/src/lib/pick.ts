// A picture by its name, with fallbacks. A name counts only once shots.json has it and both of its files are
// in public/shots, so a page can name a picture before it is taken and show an older one until then.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import shots from '../data/shots.json';

const dir = join(process.cwd(), 'public', 'shots');
const known = shots as Record<string, { w: number; h: number; scale: number }>;

export const has = (name: string) => name in known && existsSync(join(dir, `${name}-light.webp`)) && existsSync(join(dir, `${name}-dark.webp`));

/** The first choice whose picture exists, else the last (which Shot then reports if it is missing too). */
export function first<T extends { name: string }>(choices: T[]): T {
  return choices.find((c) => has(c.name)) ?? choices[choices.length - 1];
}
