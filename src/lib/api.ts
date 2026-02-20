const STORAGE_KEY = "stock_tool_api_key";

export function getStoredApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredApiKey(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, key);
}

export function clearStoredApiKey(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

function getHeaders(): HeadersInit {
  const key = typeof window !== "undefined" ? getStoredApiKey() : null;
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (key) {
    headers["Authorization"] = `Bearer ${key}`;
    headers["x-api-key"] = key;
  }
  return headers;
}

async function handleRes<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? res.statusText);
  }
  return data as T;
}

const base = "";

export const api = {
  // Data
  quote: (symbol: string) =>
    fetch(`${base}/api/data/quote?symbol=${encodeURIComponent(symbol)}`, {
      headers: getHeaders(),
    }).then(handleRes),

  profile: (symbol: string) =>
    fetch(`${base}/api/data/profile?symbol=${encodeURIComponent(symbol)}`, {
      headers: getHeaders(),
    }).then(handleRes),

  news: (symbol?: string) => {
    const url = symbol
      ? `${base}/api/data/news?symbol=${encodeURIComponent(symbol)}`
      : `${base}/api/data/news?category=general`;
    return fetch(url, { headers: getHeaders() }).then(handleRes);
  },

  fundamentals: (symbol: string) =>
    fetch(`${base}/api/data/fundamentals?symbol=${encodeURIComponent(symbol)}`, {
      headers: getHeaders(),
    }).then(handleRes),

  short: (symbol: string) =>
    fetch(`${base}/api/data/short?symbol=${encodeURIComponent(symbol)}`, {
      headers: getHeaders(),
    }).then(handleRes),

  institutional: (symbol: string) =>
    fetch(`${base}/api/data/institutional?symbol=${encodeURIComponent(symbol)}`, {
      headers: getHeaders(),
    }).then(handleRes),

  search: (q: string) =>
    fetch(`${base}/api/data/search?q=${encodeURIComponent(q)}`, {
      headers: getHeaders(),
    }).then(handleRes),

  candles: (symbol: string, resolution = "D") =>
    fetch(
      `${base}/api/data/candles?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}`,
      { headers: getHeaders() }
    ).then(handleRes),

  // Watchlists
  watchlists: {
    list: () => fetch(`${base}/api/watchlists`, { headers: getHeaders() }).then(handleRes),
    create: (name: string) =>
      fetch(`${base}/api/watchlists`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ name }),
      }).then(handleRes),
    get: (id: string) =>
      fetch(`${base}/api/watchlists/${id}`, { headers: getHeaders() }).then(handleRes),
    update: (id: string, name: string) =>
      fetch(`${base}/api/watchlists/${id}`, {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ name }),
      }).then(handleRes),
    delete: (id: string) =>
      fetch(`${base}/api/watchlists/${id}`, {
        method: "DELETE",
        headers: getHeaders(),
      }).then(handleRes),
    addSymbol: (id: string, symbol: string) =>
      fetch(`${base}/api/watchlists/${id}/symbols`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ symbol }),
      }).then(handleRes),
    removeSymbol: (id: string, symbol: string) =>
      fetch(`${base}/api/watchlists/${id}/symbols?symbol=${encodeURIComponent(symbol)}`, {
        method: "DELETE",
        headers: getHeaders(),
      }).then(handleRes),
  },

  // Positions
  positions: {
    list: () => fetch(`${base}/api/positions`, { headers: getHeaders() }).then(handleRes),
    create: (name: string) =>
      fetch(`${base}/api/positions`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ name }),
      }).then(handleRes),
    get: (id: string) =>
      fetch(`${base}/api/positions/${id}`, { headers: getHeaders() }).then(handleRes),
    update: (id: string, name: string) =>
      fetch(`${base}/api/positions/${id}`, {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ name }),
      }).then(handleRes),
    delete: (id: string) =>
      fetch(`${base}/api/positions/${id}`, {
        method: "DELETE",
        headers: getHeaders(),
      }).then(handleRes),
    addItem: (id: string, symbol: string, quantity?: number, entry_price?: number) =>
      fetch(`${base}/api/positions/${id}/items`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ symbol, quantity, entry_price }),
      }).then(handleRes),
    removeItem: (id: string, symbol: string) =>
      fetch(`${base}/api/positions/${id}/items?symbol=${encodeURIComponent(symbol)}`, {
        method: "DELETE",
        headers: getHeaders(),
      }).then(handleRes),
  },

  // Prompts
  prompts: {
    list: () => fetch(`${base}/api/prompts`, { headers: getHeaders() }).then(handleRes),
    create: (title: string, prompt_text: string) =>
      fetch(`${base}/api/prompts`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ title, prompt_text }),
      }).then(handleRes),
    get: (id: string) =>
      fetch(`${base}/api/prompts/${id}`, { headers: getHeaders() }).then(handleRes),
    update: (id: string, title?: string, prompt_text?: string) =>
      fetch(`${base}/api/prompts/${id}`, {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ title, prompt_text }),
      }).then(handleRes),
    delete: (id: string) =>
      fetch(`${base}/api/prompts/${id}`, {
        method: "DELETE",
        headers: getHeaders(),
      }).then(handleRes),
  },

  // AI
  aiRun: (prompt: string, symbol: string, context?: Record<string, unknown>) =>
    fetch(`${base}/api/ai/run`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ prompt, symbol, context }),
    }).then(handleRes),
};
