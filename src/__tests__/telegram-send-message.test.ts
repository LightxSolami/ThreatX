jest.mock("@/lib/telegram/api", () => ({}));

import { TelegramBot } from "@/lib/telegram/handler";

describe("TelegramBot.sendMessage", () => {
  const originalFetch = global.fetch;
  const bot = new TelegramBot("test-bot-token", "threatxofficialbot");

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("throws when Telegram rejects a message even with an HTTP 200 response", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
        ok: false,
        description: "Bad Request: can't parse entities",
        }),
      },
    );

    await expect(bot.sendMessage(123, "test"))
      .rejects.toThrow("Telegram sendMessage failed: Bad Request: can't parse entities");
  });

  it("returns successful Telegram responses", async () => {
    const result = { ok: true, result: { message_id: 1 } };
    global.fetch = jest.fn().mockResolvedValue(
      {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(result),
      },
    );

    await expect(bot.sendMessage(123, "test")).resolves.toEqual(result);
  });
});
