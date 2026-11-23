/** @jest-environment node */

jest.mock("server-only", () => ({}));

import { stripProviderNamesFromSession } from "@/lib/ai-news/discussion-repository";

describe("discussion provider privacy", () => {
  it("removes provider identities from previously saved sessions returned to users", () => {
    const session = {
      id: "discussion-1",
      newsItems: [],
      summary: "An unsupported public claim.",
      startedAt: "2026-11-23T12:00:00.000Z",
      rounds: [{
        round: 1,
        topic: "Round 1",
        messages: [{
          personaId: "analyst",
          personaName: "Analyst",
          role: "Market Analyst",
          content: "A measured perspective.",
          provider: "Groq",
          timestamp: "2026-11-23T12:00:00.000Z",
          color: "#fff",
          avatar: "📊",
        }],
      }],
    };

    const parsed = stripProviderNamesFromSession(JSON.stringify(session));

    expect(parsed.rounds[0].messages[0]).not.toHaveProperty("provider");
    expect(parsed.rounds[0].messages[0]).not.toHaveProperty("avatar");
    expect(parsed.rounds[0].messages[0].content).toContain("withheld");
    expect(parsed.summary).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain("unsupported public claim");
    expect(JSON.stringify(parsed)).not.toContain("Groq");
  });
});
