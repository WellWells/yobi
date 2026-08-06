export function buildManualAuthHeaders(token: string, headerName?: string): Record<string, string> {
  const name = headerName?.trim();
  return name ? { [name]: token } : { Authorization: `Bearer ${token}` };
}
