import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPythonTickerNews, isPythonServiceConfigured } from "./python-service";

describe("python-service", () => {
  const origUrl = process.env.PYTHON_SERVICE_URL;
  const origKey = process.env.PYTHON_SERVICE_KEY;

  beforeEach(() => {
    process.env.PYTHON_SERVICE_URL = "https://py.example.test";
    process.env.PYTHON_SERVICE_KEY = "test-key";
  });

  afterEach(() => {
    process.env.PYTHON_SERVICE_URL = origUrl;
    process.env.PYTHON_SERVICE_KEY = origKey;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("isPythonServiceConfigured reflects env", () => {
    expect(isPythonServiceConfigured()).toBe(true);
    delete process.env.PYTHON_SERVICE_URL;
    expect(isPythonServiceConfigured()).toBe(false);
  });

  it("fetchPythonTickerNews POSTs normalized tickers and parses data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          data: {
            AAPL: [{ title: "Hello", publisher: "X", published_at: 1, link: "https://a", type: "STORY" }],
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchPythonTickerNews({ tickers: ["aapl", "AAPL"], hoursBack: 48 });
    expect(out.data.AAPL).toHaveLength(1);
    expect(out.data.AAPL[0].title).toBe("Hello");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://py.example.test/news");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-key",
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({ tickers: ["AAPL"], hours_back: 48 });
  });

  it("chunks tickers into batches of 40 for Python /news", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { tickers: string[] };
      const data = Object.fromEntries(
        body.tickers.map((t) => [t, [{ title: "h", publisher: null, published_at: null, link: null, type: null }]])
      );
      return { ok: true, text: async () => JSON.stringify({ data }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const tickers = Array.from({ length: 41 }, (_, i) => `T${i}`);
    const out = await fetchPythonTickerNews({ tickers, hoursBack: 24 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).tickers).toHaveLength(40);
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).tickers).toHaveLength(1);
    expect(Object.keys(out.data)).toHaveLength(41);
  });

  it("returns empty data when all tickers invalid", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchPythonTickerNews({ tickers: ["", "  "] });
    expect(out.data).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
