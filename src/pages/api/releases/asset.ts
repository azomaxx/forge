import type { APIContext } from "astro";
import { getRequiredEnv } from "../../../lib/runtime";

export const prerender = false;

async function githubRequest<T>(
  context: APIContext,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getRequiredEnv(context, "FORGE_GITHUB_TOKEN");
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "forge-ui/1.0",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${response.status}: ${text}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function GET(context: APIContext) {
  const tag = context.url.searchParams.get("tag") ?? "";
  const assetName = context.url.searchParams.get("name") ?? "";

  if (!tag || !assetName) {
    return new Response("Missing tag or name parameter", { status: 400 });
  }

  try {
    const repo = getRequiredEnv(context, "FORGE_GITHUB_REPO");
    
    const releaseData = await githubRequest<{ assets: Array<{ name: string; browser_download_url: string }> }>(
      context,
      `/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`
    );
    
    const assetData = releaseData.assets.find((a: { name: string; browser_download_url: string }) => a.name === assetName);
    if (!assetData?.browser_download_url) {
      return new Response("Asset not found", { status: 404 });
    }

    return Response.redirect(assetData.browser_download_url, 302);
  } catch (error) {
    console.error("Download error:", error);
    return new Response("Download failed", { status: 500 });
  }
}
