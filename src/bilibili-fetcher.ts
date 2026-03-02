import { buildWbiSignedUrl } from "./wbi.js";

export interface SubtitleTrack {
  languageCode: string;
  content: string;
}

export interface VideoInfo {
  title: string;
  author: string;
  viewCount: string;
  description: string;
  lengthSeconds: string;
  publishDate: string;
  subtitle?: SubtitleTrack;
}

/**
 * Extract BVID from a Bilibili video URL.
 * Supports formats like:
 *   https://www.bilibili.com/video/BVxxxxxxx
 *   https://m.bilibili.com/video/BVxxxxxxx?k=v
 *   https://bilibili.com/video/BVxxxxxxx/
 */
export function extractBvid(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("bilibili.com")) {
      throw new Error("Not a bilibili.com URL");
    }
    // pathname like /video/BVxxxxxxxxxx or /video/BVxxxxxxxxxx/
    const match = parsed.pathname.match(/\/video\/(BV[A-Za-z0-9]+)/i);
    if (!match) {
      throw new Error(
        "Could not extract BVID from URL. Expected format: bilibili.com/video/BVxxxxx"
      );
    }
    return match[1];
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error(`Invalid URL: ${url}`);
    }
    throw e;
  }
}

/**
 * Format a Unix timestamp (seconds) to ISO 8601 datetime string with +08:00 timezone.
 * Example output: 2025-12-29T22:04:34+08:00
 */
function formatPubdate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  // Convert to UTC+8
  const utc8Offset = 8 * 60; // minutes
  const localOffset = date.getTimezoneOffset(); // minutes, negative for east
  const utc8Time = new Date(
    date.getTime() + (utc8Offset + localOffset) * 60 * 1000
  );

  const year = utc8Time.getFullYear();
  const month = String(utc8Time.getMonth() + 1).padStart(2, "0");
  const day = String(utc8Time.getDate()).padStart(2, "0");
  const hours = String(utc8Time.getHours()).padStart(2, "0");
  const minutes = String(utc8Time.getMinutes()).padStart(2, "0");
  const seconds = String(utc8Time.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+08:00`;
}

interface BilibiliApiResponse {
  code: number;
  message: string;
  data: Record<string, unknown>;
}

/**
 * Fetch basic video info from Bilibili API.
 */
async function fetchVideoDetail(bvid: string): Promise<{
  title: string;
  author: string;
  viewCount: string;
  description: string;
  duration: number;
  pubdate: number;
  cid: number;
}> {
  const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
  const res = await fetch(apiUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://www.bilibili.com",
    },
  });

  if (!res.ok) {
    throw new Error(`Bilibili API request failed with status ${res.status}`);
  }

  const json = (await res.json()) as BilibiliApiResponse;
  if (json.code !== 0) {
    throw new Error(`Bilibili API error: ${json.message}`);
  }

  const data = json.data as Record<string, unknown>;
  const stat = data.stat as Record<string, unknown>;
  const owner = data.owner as Record<string, unknown>;

  // desc_v2 is an array of objects with raw_text, fallback to desc
  let description = "";
  if (Array.isArray(data.desc_v2) && data.desc_v2.length > 0) {
    description = (data.desc_v2 as Array<{ raw_text: string }>)
      .map((item) => item.raw_text)
      .join("\n");
  } else {
    description = (data.desc as string) || "";
  }

  return {
    title: data.title as string,
    author: owner.name as string,
    viewCount: String(stat.view),
    description,
    duration: data.duration as number,
    pubdate: data.pubdate as number,
    cid: data.cid as number,
  };
}

interface SubtitleInfo {
  lan: string;
  lan_doc: string;
  subtitle_url: string;
}

/**
 * Fetch a single subtitle track content from its URL.
 */
async function fetchSubtitleContent(
  sub: SubtitleInfo
): Promise<SubtitleTrack | null> {
  let url = sub.subtitle_url;
  if (url.startsWith("/")) {
    url = `https:${url}`;
  }

  try {
    const subRes = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.bilibili.com",
      },
    });

    if (!subRes.ok) {
      return null;
    }

    const subJson = (await subRes.json()) as {
      body: Array<{ content: string }>;
    };
    const content = subJson.body.map((it) => it.content).join(" ");

    return {
      languageCode: sub.lan,
      content,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch subtitles for a video using BVID, CID and SESSDATA cookie.
 * Uses the WBI-signed /x/player/wbi/v2 endpoint for reliable results.
 * Priority: Chinese first, then English. Returns only one subtitle track.
 */
async function fetchSubtitle(
  bvid: string,
  cid: number,
  sessdata: string
): Promise<SubtitleTrack | null> {
  const apiUrl = await buildWbiSignedUrl(
    "https://api.bilibili.com/x/player/wbi/v2",
    { bvid, cid },
    sessdata
  );

  const res = await fetch(apiUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://www.bilibili.com/",
      Cookie: `SESSDATA=${sessdata}`,
    },
  });

  if (!res.ok) {
    throw new Error(
      `Bilibili player API request failed with status ${res.status}`
    );
  }

  const json = (await res.json()) as BilibiliApiResponse;
  if (json.code !== 0) {
    throw new Error(`Bilibili player API error: ${json.message}`);
  }

  const data = json.data as Record<string, unknown>;

  // Check if login is required for subtitles
  if (data.need_login_subtitle === true) {
    throw new Error(
      "Subtitles require login. Your SESSDATA cookie may be expired. " +
        "Please update the SESSDATA environment variable with a fresh cookie."
    );
  }

  const subtitleData = data.subtitle as Record<string, unknown>;
  const subtitles = (subtitleData?.subtitles as SubtitleInfo[]) || [];

  if (subtitles.length === 0) {
    return null;
  }

  // Priority: Chinese first, then English
  const chineseSub = subtitles.find(
    (s) =>
      s.lan_doc.includes("中文") ||
      s.lan === "zh-CN" ||
      s.lan === "zh-Hans" ||
      s.lan === "zh"
  );
  const englishSub = subtitles.find(
    (s) =>
      s.lan_doc.includes("English") ||
      s.lan_doc.includes("英语") ||
      s.lan === "en" ||
      s.lan === "en-US"
  );

  const selectedSub = chineseSub || englishSub;
  if (!selectedSub) {
    return null;
  }

  return await fetchSubtitleContent(selectedSub);
}

/**
 * Main entry point: fetch Bilibili video info and optionally subtitles.
 */
export async function getBilibiliVideoInfo(
  url: string,
  includeSubtitles: boolean
): Promise<VideoInfo> {
  const bvid = extractBvid(url);
  const detail = await fetchVideoDetail(bvid);

  const info: VideoInfo = {
    title: detail.title,
    author: detail.author,
    viewCount: detail.viewCount,
    description: detail.description,
    lengthSeconds: String(detail.duration),
    publishDate: formatPubdate(detail.pubdate),
  };

  if (includeSubtitles) {
    const sessdata = process.env.SESSDATA;
    if (!sessdata) {
      throw new Error(
        "Environment variable SESSDATA is not set. " +
          "Please set your Bilibili login cookie SESSDATA to fetch subtitles. " +
          "You can find it in your browser cookies after logging into bilibili.com."
      );
    }

    const subtitle = await fetchSubtitle(bvid, detail.cid, sessdata);
    if (subtitle) {
      info.subtitle = subtitle;
    }
  }

  return info;
}
