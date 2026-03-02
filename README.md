# bilibili-info-mcp

MCP server for fetching Bilibili video metadata and subtitles. Runs locally via stdio transport.

## Features

- Fetch video metadata: title, author, view count, description, duration, publish date
- Fetch subtitles (requires login cookie): prioritizes Chinese, falls back to English
- WBI signature support for reliable subtitle retrieval
- Stdio transport for local MCP client integration

## Project Structure

```
src/
  index.ts              # MCP server entry point (stdio transport)
  bilibili-fetcher.ts   # Bilibili API calls (video info + subtitles)
  wbi.ts                # WBI signature algorithm implementation
```

## Setup

```bash
npm install
npm run build
```

## MCP Client Configuration

### Cursor / Claude Desktop

```json
{
  "mcpServers": {
    "bilibili-info": {
      "command": "node",
      "args": ["/absolute/path/to/bilibili-info-mcp/dist/index.js"],
      "env": {
        "SESSDATA": "your_bilibili_sessdata_cookie"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SESSDATA` | Only for subtitles | Bilibili login cookie. Find it in browser DevTools > Application > Cookies > `bilibili.com` after logging in. |

## Tool: `get-bilibili-video-info`

Fetches Bilibili video metadata and optionally subtitles.

### Input

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | Yes | - | Bilibili video URL, e.g. `https://www.bilibili.com/video/BVxxxxx` |
| `includeSubtitles` | boolean | No | `false` | Whether to fetch subtitles. Requires `SESSDATA` env var. |

Supported URL formats:
- `https://www.bilibili.com/video/BVxxxxx`
- `https://m.bilibili.com/video/BVxxxxx?k=v`
- `https://bilibili.com/video/BVxxxxx/`

### Output

```json
{
  "title": "Video title",
  "author": "Author name",
  "viewCount": "12345",
  "description": "Video description",
  "lengthSeconds": "360",
  "publishDate": "2025-01-15T12:00:00+08:00",
  "subtitle": {
    "languageCode": "zh-Hans",
    "content": "Subtitle text content joined by spaces"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `title` | string | Video title |
| `author` | string | Uploader name |
| `viewCount` | string | Total view count |
| `description` | string | Video description (prefers `desc_v2`, falls back to `desc`) |
| `lengthSeconds` | string | Video duration in seconds |
| `publishDate` | string | Publish time in ISO 8601 format with `+08:00` timezone |
| `subtitle` | object (optional) | Subtitle track, only present when `includeSubtitles` is `true` and subtitles are available |

### Subtitle Priority

When `includeSubtitles` is `true`, returns a single subtitle track with the following priority:

1. Chinese (matching `中文`, `zh-CN`, `zh-Hans`, `zh`)
2. English (matching `English`, `英语`, `en`, `en-US`)

## How It Works

1. **Video info** -- Calls `https://api.bilibili.com/x/web-interface/view?bvid=BVID` to get metadata.
2. **WBI keys** -- Fetches `img_key` and `sub_key` from `https://api.bilibili.com/x/web-interface/nav` (cached for 1 hour).
3. **Subtitles** -- Calls `https://api.bilibili.com/x/player/wbi/v2` with WBI signature (`w_rid` + `wts`) and `SESSDATA` cookie to get subtitle URLs, then fetches the subtitle JSON content.

## License

ISC
