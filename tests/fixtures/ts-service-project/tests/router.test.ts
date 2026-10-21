import { registerOrderRoutes } from '../src/router.js';

export function testRouter(): boolean {
  return registerOrderRoutes() === 'ok';
}
