import type { APIContext } from "astro";
import { listForgeReleases } from "../../lib/github";

export const prerender = false;

export async function GET(context: APIContext) {
  try {
    const repoUrl = context.url.searchParams.get("repo_url") ?? "";
    const releases = await listForgeReleases(context, repoUrl);
    return Response.json({ releases });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load releases" },
      { status: 400 },
    );
  }
}
