#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getBilibiliVideoInfo } from "./bilibili-fetcher.js";

const server = new McpServer(
  { name: "bilibili-info-mcp", version: "1.0.0" },
  { capabilities: { logging: {} } }
);

const inputSchema = {
  url: z.string().describe("Bilibili video URL, e.g. https://www.bilibili.com/video/BVxxxxx"),
  includeSubtitles: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Whether to include subtitles/captions in the response. Requires SESSDATA environment variable to be set."
    ),
};

const outputSchema = {
  title: z.string(),
  author: z.string(),
  viewCount: z.string(),
  description: z.string(),
  lengthSeconds: z.string(),
  publishDate: z.string(),
  subtitle: z
    .object({
      languageCode: z.string(),
      content: z.string(),
    })
    .optional(),
};

server.registerTool(
  "get-bilibili-video-info",
  {
    description:
      "Fetches Bilibili video metadata (title, author, duration, description, publish date, view count) and subtitles/captions.",
    inputSchema,
    outputSchema,
  },
  async ({ url, includeSubtitles }) => {
    try {
      const info = await getBilibiliVideoInfo(url, includeSubtitles);

      return {
        structuredContent: info as unknown as Record<string, unknown>,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(info),
          },
        ],
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: message }),
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
