// Stable coordinate hashing: terrain must not depend on chunk visit order.
export function worldRandom(seed: number, x: number, y: number, z: number, salt = 0): number {
  let hash = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)
    ^ Math.imul(z, 1274126177) ^ Math.imul(salt, 1597334677)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}
