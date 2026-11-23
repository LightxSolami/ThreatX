import { z } from "zod";
import { isSafeSourceUrl } from "./verification";

const NewsItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  url: z.string().url(),
  source: z.string(),
  publishedAt: z.string().datetime({ offset: true }),
  retrievedAt: z.string().datetime({ offset: true }).optional(),
  category: z.enum(["solana", "defi", "nft", "infrastructure", "regulation", "market", "security", "general"]),
  feedSource: z.string().optional(),
  tags: z.array(z.string()).default([]),
  relevanceScore: z.number().min(0).max(1).default(0.5),
});

export type NewsItem = z.infer<typeof NewsItemSchema>;

const RSS_FEEDS = [
  { name: "Google News", url: "https://news.google.com/rss/search?q=Solana+OR+%22SOL+token%22&hl=en-US&gl=US&ceid=US:en", category: "market" as const },
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", category: "market" as const },
  { name: "The Block", url: "https://www.theblock.co/rss.xml", category: "market" as const },
  { name: "CoinTelegraph", url: "https://cointelegraph.com/rss", category: "market" as const },
  { name: "Decrypt", url: "https://decrypt.co/feed", category: "market" as const },
  { name: "Bankless", url: "https://bankless.substack.com/feed", category: "defi" as const },
  { name: "Solana Foundation Blog", url: "https://solana.com/news/rss.xml", category: "solana" as const },
  { name: "Solana Dev Blog", url: "https://solana.com/developers/rss.xml", category: "infrastructure" as const },
];

const SOLANA_ECOSYSTEM_KEYWORDS = [
  "solana", "sol", "jupiter", "raydium", "orca", "marinade", "jito", "drift",
  "kamino", "marginfi", "solend", "bonk", "wif", "pyth", "switchboard",
  "wormhole", "layerzero", "celo", "neon", "eclipse", "monad", "anvill",
  "token-2022", "token22", "compressed nft", "cNFT", "metaplex", "candy machine",
  "anchor", "sealevel", "gulfstream", "turbine", "cloudbreak", "archivers",
  "fire dancer", "firedancer", "jito-sol", "stake", "validator", "rpc",
  "helius", "quicknode", "alchemy", "triton", "genesysgo", "shyft",
];

export function calculateRelevance(title: string, summary: string): number {
  const text = (title + " " + summary).toLowerCase();
  let score = 0;
  for (const keyword of SOLANA_ECOSYSTEM_KEYWORDS) {
    const escapedKeyword = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[^a-z0-9])${escapedKeyword}(?=$|[^a-z0-9])`, "i");
    if (pattern.test(text)) {
      score += 0.15;
    }
  }
  return Math.min(score, 1.0);
}

function categorizeItem(title: string, summary: string, feedCategory: string): NewsItem["category"] {
  const text = (title + " " + summary).toLowerCase();
  if (text.includes("solana") || text.includes("sol ")) return "solana";
  if (text.includes("defi") || text.includes("dex") || text.includes("amm") || text.includes("lending")) return "defi";
  if (text.includes("nft") || text.includes("non-fungible") || text.includes("cNFT") || text.includes("metaplex")) return "nft";
  if (text.includes("validator") || text.includes("rpc") || text.includes("infrastructure") || text.includes("client")) return "infrastructure";
  if (text.includes("regulation") || text.includes("sec") || text.includes("legal") || text.includes("compliance")) return "regulation";
  if (text.includes("hack") || text.includes("exploit") || text.includes("vulnerab") || text.includes("security")) return "security";
  return "market";
}

async function fetchRSSFeed(feed: { name: string; url: string; category: string }): Promise<NewsItem[]> {
  try {
    const response = await fetch(feed.url, {
      headers: { "User-Agent": "THREATX-AI-News/1.0" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const xml = await response.text();
    const items = parseRSS(xml, feed.name, feed.category);
    return items;
  } catch (error) {
    console.error(`Failed to fetch ${feed.name}:`, error);
    return [];
  }
}

export function parseRSS(xml: string, source: string, feedCategory: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = decodeXmlText(extractTag(itemXml, "title") || "");
    const link = decodeXmlText(extractTag(itemXml, "link") || "");
    const description = decodeXmlText(extractTag(itemXml, "description") || extractTag(itemXml, "content:encoded") || "");
    const originalPublisher = decodeXmlText(extractTag(itemXml, "source") || "");
    const pubDate = extractTag(itemXml, "pubDate") || extractTag(itemXml, "dc:date");

    if (!title || !link || !pubDate || !isSafeSourceUrl(link)) continue;
    const publicationDate = new Date(pubDate);
    if (Number.isNaN(publicationDate.getTime())) continue;

    const cleanSummary = description
      .replace(/<[^>]+>/g, "")
      .replace(/&[a-z]+;/g, " ")
      .trim()
      .slice(0, 500);

    const publishedAt = publicationDate.toISOString();
    const relevanceScore = calculateRelevance(title, cleanSummary);
    const category = categorizeItem(title, cleanSummary, feedCategory);

    if (relevanceScore < 0.1 && category !== "solana") continue;

    items.push({
      id: `${source}-${Buffer.from(link).toString("base64").slice(0, 16)}`,
      title: title.trim(),
      summary: cleanSummary,
      url: link,
      source: source === "Google News" && originalPublisher
        ? `Google News · ${originalPublisher}`
        : source,
      feedSource: source,
      publishedAt,
      retrievedAt: new Date().toISOString(),
      category,
      tags: extractTags(title, cleanSummary),
      relevanceScore,
    });
  }

  return items;
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function decodeXmlText(value: string): string {
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  const text = cdata ? cdata[1] : value;
  const decodeCodePoint = (code: string, radix: number) => {
    const point = parseInt(code, radix);
    return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
      ? String.fromCodePoint(point)
      : " ";
  };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => decodeCodePoint(code, 16))
    .replace(/&#(\d+);/g, (_, code: string) => decodeCodePoint(code, 10))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractTags(title: string, summary: string): string[] {
  const text = (title + " " + summary).toLowerCase();
  const tags: string[] = [];
  const knownTags = [
    "defi", "nft", "dao", "web3", "gaming", "memecoin", "stablecoin",
    "staking", "validator", "rpc", "mev", "airdrop", "tokenomics",
    "governance", "bridge", "cross-chain", "l2", "rollup", "zk",
    "ai", "depin", "rwa", "tokenization", "etf", "institutional"
  ];
  for (const tag of knownTags) {
    if (text.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, 5);
}

async function fetchSolanaFoundationUpdates(): Promise<NewsItem[]> {
  try {
    const response = await fetch("https://solana.com/api/news", {
      headers: { Accept: "application/json" },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];

    const data = await response.json();
    return data.items?.slice(0, 10).map((item: any) => ({
      id: `solana-foundation-${item.id || item.slug}`,
      title: item.title,
      summary: item.excerpt || item.content?.slice(0, 500) || "",
      url: `https://solana.com${item.url || "/news/" + item.slug}`,
      source: "Solana Foundation",
      publishedAt: item.date || item.publishedAt,
      retrievedAt: new Date().toISOString(),
      category: "solana" as const,
      tags: item.tags || [],
      relevanceScore: 1.0,
    })).filter((item: NewsItem) => isSafeSourceUrl(item.url)) || [];
  } catch {
    return [];
  }
}

export async function fetchAllNews(): Promise<NewsItem[]> {
  const [rssResults, solanaResults] = await Promise.all([
    Promise.all(RSS_FEEDS.map(fetchRSSFeed)),
    fetchSolanaFoundationUpdates(),
  ]);

  const allItems = [...rssResults.flat(), ...solanaResults];

  const uniqueItems = new Map<string, NewsItem>();
  for (const item of allItems) {
    const existing = uniqueItems.get(item.url);
    if (!existing || item.relevanceScore > existing.relevanceScore) {
      uniqueItems.set(item.url, item);
    }
  }

  return Array.from(uniqueItems.values())
    .filter(item => NewsItemSchema.safeParse(item).success && isSafeSourceUrl(item.url))
    .sort((a, b) => {
      const aTime = Date.parse(a.publishedAt);
      const bTime = Date.parse(b.publishedAt);
      const now = Date.now();
      const aIsFresh = now - aTime <= 24 * 60 * 60 * 1000;
      const bIsFresh = now - bTime <= 24 * 60 * 60 * 1000;
      if (aIsFresh !== bIsFresh) return aIsFresh ? -1 : 1;
      return bTime - aTime || b.relevanceScore - a.relevanceScore;
    })
    .slice(0, 50);
}

export function selectDiverseNews(news: NewsItem[], limit: number): NewsItem[] {
  const selected: NewsItem[] = [];
  const sourceCounts = new Map<string, number>();
  const sourceCount = new Set(news.map(item => item.feedSource || item.source)).size;
  const perSourceLimit = sourceCount <= 1
    ? limit
    : Math.max(1, Math.min(Math.ceil(limit * 0.3), Math.ceil(limit / sourceCount)));

  for (const item of news) {
    const publisher = item.feedSource || item.source;
    const count = sourceCounts.get(publisher) || 0;
    if (count < perSourceLimit && selected.length < limit) {
      selected.push(item);
      sourceCounts.set(publisher, count + 1);
    }
  }

  return selected;
}

export async function getTopNews(limit = 10): Promise<NewsItem[]> {
  const allNews = await fetchAllNews();
  return selectDiverseNews(allNews, limit);
}

export async function getNewsByCategory(category: NewsItem["category"], limit = 10): Promise<NewsItem[]> {
  const allNews = await fetchAllNews();
  return allNews.filter(n => n.category === category).slice(0, limit);
}