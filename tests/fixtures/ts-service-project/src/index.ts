import { registerOrderRoutes } from './router.js';

export function startGateway(): string {
  return registerOrderRoutes();
}
