import type { APIContext } from "astro";
import { inspectRepository } from "../../../lib/github";

export const prerender = false;

export async function POST(context: APIContext) {
  try {
    const payload = (await context.request.json()) as { repo_url?: string };
    const data = await inspectRepository(context, payload.repo_url ?? "");
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Repository inspection failed" },
      { status: 400 },
    );
  }
}
