import { createHash } from "crypto";

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Shuffle img_key + sub_key according to MIXIN_KEY_ENC_TAB, take first 32 chars.
 */
function getMixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey;
  return MIXIN_KEY_ENC_TAB.map((i) => raw[i]).join("").slice(0, 32);
}

function md5(str: string): string {
  return createHash("md5").update(str).digest("hex");
}

/**
 * Sign request parameters with WBI.
 * Returns the full signed query string.
 */
function encWbi(
  params: Record<string, string | number>,
  imgKey: string,
  subKey: string
): string {
  const mixinKey = getMixinKey(imgKey, subKey);
  const wts = Math.floor(Date.now() / 1000);

  // Copy params and add wts
  const allParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    allParams[k] = String(v);
  }
  allParams["wts"] = String(wts);

  // Sort by key
  const sortedKeys = Object.keys(allParams).sort();

  // Build query string: filter !'()* from values, use encodeURIComponent
  const queryParts = sortedKeys.map((k) => {
    const filtered = allParams[k].replace(/[!'()*]/g, "");
    return `${encodeURIComponent(k)}=${encodeURIComponent(filtered)}`;
  });
  const query = queryParts.join("&");

  // Calculate w_rid
  const wRid = md5(query + mixinKey);

  return `${query}&w_rid=${wRid}`;
}

// Cache for wbi keys (refreshed daily)
let cachedKeys: { imgKey: string; subKey: string; fetchedAt: number } | null =
  null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch img_key and sub_key from bilibili nav API.
 * Caches the result for 1 hour.
 */
async function getWbiKeys(
  sessdata?: string
): Promise<{ imgKey: string; subKey: string }> {
  if (cachedKeys && Date.now() - cachedKeys.fetchedAt < CACHE_TTL_MS) {
    return { imgKey: cachedKeys.imgKey, subKey: cachedKeys.subKey };
  }

  const headers: Record<string, string> = {
    "User-Agent": UA,
    Referer: "https://www.bilibili.com/",
  };
  if (sessdata) {
    headers["Cookie"] = `SESSDATA=${sessdata}`;
  }

  const res = await fetch("https://api.bilibili.com/x/web-interface/nav", {
    headers,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch wbi keys: HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    code: number;
    message: string;
    data: {
      wbi_img: {
        img_url: string;
        sub_url: string;
      };
    };
  };

  // code -101 means not logged in, but wbi_img is still returned
  if (json.code !== 0 && json.code !== -101) {
    throw new Error(`Failed to fetch wbi keys: ${json.message}`);
  }

  const imgUrl = json.data.wbi_img.img_url;
  const subUrl = json.data.wbi_img.sub_url;

  // Extract filename without extension
  // e.g. "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png"
  //   -> "7cd084941338484aae1ad9425b84077c"
  const imgKey = imgUrl.split("/").pop()!.split(".")[0];
  const subKey = subUrl.split("/").pop()!.split(".")[0];

  cachedKeys = { imgKey, subKey, fetchedAt: Date.now() };
  return { imgKey, subKey };
}

/**
 * Build a WBI-signed URL for the given base URL and params.
 * Returns the full URL with w_rid and wts appended.
 */
export async function buildWbiSignedUrl(
  baseUrl: string,
  params: Record<string, string | number>,
  sessdata?: string
): Promise<string> {
  const { imgKey, subKey } = await getWbiKeys(sessdata);
  const signedQuery = encWbi(params, imgKey, subKey);
  return `${baseUrl}?${signedQuery}`;
}
