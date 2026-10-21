export function registerOrderRoutes(): string {
  const app = { get: (_p: string, _h: () => void) => undefined };
  app.get('/api/orders/status', () => undefined);
  return 'ok';
}
