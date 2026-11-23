/** @jest-environment node */

import { calculateRelevance, parseRSS, selectDiverseNews } from "@/lib/ai-news/news-aggregator";
import type { NewsItem } from "@/lib/ai-news/news-aggregator";

function item(source: string, index: number): NewsItem {
  return {
    id: `${source}-${index}`,
    title: `Solana ecosystem report ${index}`,
    summary: "A report about Solana.",
    url: `https://${source.toLowerCase().replace(/\s+/g, "")}.example/${index}`,
    source,
    publishedAt: new Date(Date.now() - index * 1000).toISOString(),
    category: "solana",
    tags: [],
    relevanceScore: 0.9,
  };
}

describe("AI news source ranking", () => {
  it("does not mistake the word solo for the SOL token", () => {
    expect(calculateRelevance("Solo Bitcoin miner wins block reward", "Bitcoin mining story")).toBe(0);
    expect(calculateRelevance("SOL staking update", "Solana validators")).toBeGreaterThan(0);
  });

  it("limits a single publisher to 30 percent of the selected news when alternatives exist", () => {
    const news = ["Publisher A", "Publisher B", "Publisher C"]
      .flatMap(source => [1, 2, 3].map(index => item(source, index)));

    const selected = selectDiverseNews(news, 6);

    expect(selected).toHaveLength(6);
    expect(selected.filter(entry => entry.source === "Publisher A")).toHaveLength(2);
    expect(new Set(selected.map(entry => entry.source)).size).toBe(3);
  });

  it("preserves Google News publisher attribution and decodes CDATA titles", () => {
    const news = parseRSS(
      `<rss><channel><item>
        <title><![CDATA[Solana ecosystem update &amp; outlook]]></title>
        <link>https://news.google.com/rss/articles/example</link>
        <description><![CDATA[Solana validators reported an update.]]></description>
        <source url="https://publisher.example">Example Publisher</source>
        <pubDate>Mon, 23 Nov 2026 12:00:00 GMT</pubDate>
      </item></channel></rss>`,
      "Google News",
      "market"
    );

    expect(news).toHaveLength(1);
    expect(news[0].title).toBe("Solana ecosystem update & outlook");
    expect(news[0].source).toBe("Google News · Example Publisher");
    expect(news[0].feedSource).toBe("Google News");
  });
});
