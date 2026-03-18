import type { APIContext } from "astro";
import { getRun } from "../../../lib/github";

export const prerender = false;

export async function GET(context: APIContext) {
  try {
    const run = await getRun(context, context.params.id ?? "");
    return Response.json(run);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load run" },
      { status: 400 },
    );
  }
}
