/**
 * Crypto Tools Suite — REQ-I03~I06 (MASTER-PLAN §8.2)
 * Unified adapter for:
 * - BlockBeats (律动): 1500+ info sources, fund flows, macro data
 * - CoinMarketCap: 60 API endpoints, price queries, research reports
 * - CoinAnk: Contract positions, funding rates, liquidation data
 * - Dune: Natural language on-chain data queries (no SQL needed)
 */

/**
 * @typedef {'blockbeats' | 'coinmarketcap' | 'coinank' | 'dune'} CryptoSource
 */

/**
 * @typedef {{ source: CryptoSource, type: string, data: unknown, timestamp: string }} CryptoDataPoint
 */

export function createCryptoToolsSuite(options = {}) {
  const cmcApiKey = options.cmcApiKey ?? process.env.CMC_API_KEY ?? "";
  const duneApiKey = options.duneApiKey ?? process.env.DUNE_API_KEY ?? "";

  const sources = {
    blockbeats: {
      name: "BlockBeats (律动)",
      description: "1500+ crypto news sources, fund flows, macro data",
      installed: false,
      apiUrl: "https://api.theblockbeats.news/v1",
    },
    coinmarketcap: {
      name: "CoinMarketCap",
      description: "60 API endpoints, price, market cap, volume",
      installed: !!cmcApiKey,
      apiUrl: "https://pro-api.coinmarketcap.com/v1",
    },
    coinank: {
      name: "CoinAnk",
      description: "Contract positions, funding rates, liquidation data",
      installed: false,
      apiUrl: "https://api.coinank.com/v1",
    },
    dune: {
      name: "Dune Analytics",
      description: "Natural language on-chain data queries",
      installed: !!duneApiKey,
      apiUrl: "https://api.dune.com/api/v1",
    },
  };

  /**
   * Get current crypto price from CoinMarketCap.
   * @param {{ symbol: string, convert?: string }} params
   */
  async function getPrice(params) {
    const { symbol, convert = "USD" } = params;
    if (!cmcApiKey) {
      return { ok: false, error: "CMC_API_KEY not configured" };
    }

    try {
      const url = `${sources.coinmarketcap.apiUrl}/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(symbol)}&convert=${convert}`;
      const res = await fetch(url, {
        headers: { "X-CMC_PRO_API_KEY": cmcApiKey, Accept: "application/json" },
      });
      if (!res.ok) return { ok: false, error: `CMC API error: ${res.status}` };
      const data = await res.json();
      const coin = data?.data?.[symbol.toUpperCase()];
      if (!coin) return { ok: false, error: `Symbol not found: ${symbol}` };

      const quote = coin.quote?.[convert];
      return {
        ok: true,
        source: "coinmarketcap",
        symbol: symbol.toUpperCase(),
        name: coin.name,
        price: quote?.price,
        marketCap: quote?.market_cap,
        volume24h: quote?.volume_24h,
        change24h: quote?.percent_change_24h,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Query on-chain data via Dune Analytics (natural language).
   * @param {{ query: string }} params
   */
  async function queryOnChain(params) {
    const { query } = params;
    if (!duneApiKey) {
      return { ok: false, error: "DUNE_API_KEY not configured" };
    }
    if (!query) return { ok: false, error: "query is required" };

    try {
      const res = await fetch(`${sources.dune.apiUrl}/query/execute`, {
        method: "POST",
        headers: {
          "X-DUNE-API-KEY": duneApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query_text: query }),
      });
      if (!res.ok) return { ok: false, error: `Dune API error: ${res.status}` };
      const data = await res.json();
      return { ok: true, source: "dune", result: data, timestamp: new Date().toISOString() };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Get latest crypto news headlines.
   * @param {{ limit?: number, lang?: string }} params
   */
  async function getNews(params = {}) {
    const { limit = 10, lang = "en" } = params;
    try {
      const url = `${sources.blockbeats.apiUrl}/open-api/open/flash/push?size=${limit}&lang=${lang}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return { ok: false, error: `BlockBeats API error: ${res.status}` };
      const data = await res.json();
      return {
        ok: true,
        source: "blockbeats",
        articles: (data?.data?.data ?? []).map(a => ({
          title: a.title,
          content: a.content?.slice(0, 500),
          timestamp: a.add_time,
        })),
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { ok: false, error: err.message ?? String(err) };
    }
  }

  function getStatus() {
    return {
      sources: Object.fromEntries(
        Object.entries(sources).map(([k, v]) => [k, { name: v.name, installed: v.installed }])
      ),
      cmcConfigured: !!cmcApiKey,
      duneConfigured: !!duneApiKey,
    };
  }

  return {
    getPrice,
    queryOnChain,
    getNews,
    getStatus,
    sources,
  };
}
