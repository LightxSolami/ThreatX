import { formatScore } from "@/lib/telegram/bot";

describe("Telegram scan score formatting", () => {
  it("does not display a numeric score when the scan score is unavailable", () => {
    expect(formatScore(null)).toBe("⚪ Not scored");
  });
});
