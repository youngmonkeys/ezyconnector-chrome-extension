export interface HttpProxyPayload {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpProxyResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export async function handleHttpProxy(payload: HttpProxyPayload): Promise<HttpProxyResult> {
  if (!payload.url) {
    throw new Error('url is required');
  }

  const response = await fetch(payload.url, {
    method: payload.method ?? 'GET',
    headers: payload.headers,
    body: payload.body,
    credentials: 'include',
  });

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const body = await response.text();

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
  };
}
