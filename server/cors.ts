const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost",
  "http://localhost:5173",
  "http://salvare-woo-test.local",
  "https://salvare-test-store.myshopify.com",
]);

export function buildCorsHeaders(
  origin: string | undefined | null,
): Record<string, string> | null {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
