import type { APIContext } from "astro";
import { buildCatalogSuggestion } from "../../../lib/forge-data";

export const prerender = false;

export async function POST(context: APIContext) {
  try {
    const body = (await context.request.json()) as { repo_url?: string };
    return Response.json({
      suggestion: buildCatalogSuggestion(body.repo_url ?? ""),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to prepare suggestion" },
      { status: 400 },
    );
  }
}
