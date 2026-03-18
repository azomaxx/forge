import type { APIContext } from "astro";
import { dispatchBuild } from "../../lib/github";

export const prerender = false;

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function cleanExpiredEntries() {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}

function checkRateLimit(ip: string): boolean {
  cleanExpiredEntries();
  
  const now = Date.now();
  const record = rateLimitStore.get(ip);
  
  if (!record || record.resetAt < now) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  
  if (record.count >= RATE_LIMIT) {
    return false;
  }
  
  record.count++;
  return true;
}

function getClientIP(context: APIContext): string {
  const cf = context.locals.cloudflare as { env?: { CF_IP?: string } } | undefined;
  const forwarded = context.request.headers.get("x-forwarded-for");
  const realIP = context.request.headers.get("x-real-ip");
  
  if (cf?.env?.CF_IP) return cf.env.CF_IP;
  if (forwarded) return forwarded.split(",")[0].trim();
  if (realIP) return realIP;
  
  return "unknown";
}

export async function POST(context: APIContext) {
  const clientIP = getClientIP(context);
  
  if (!checkRateLimit(clientIP)) {
    return Response.json(
      { error: "Rate limit exceeded. 20 builds per hour per IP. Try again later." },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

  try {
    const body = (await context.request.json()) as Record<string, string | boolean>;
    const inputs = {
      repo_url: String(body.repo_url ?? ""),
      mode: String(body.mode ?? "simple"),
      git_ref: String(body.git_ref ?? ""),
      project_path: String(body.project_path ?? ""),
      configuration: String(body.configuration ?? ""),
      target_framework: String(body.target_framework ?? ""),
      version_override: String(body.version_override ?? ""),
      asset_include: String(body.asset_include ?? ""),
      asset_exclude: String(body.asset_exclude ?? ""),
      force_rebuild: String(Boolean(body.force_rebuild)),
    };

    const dispatch = await dispatchBuild(context, inputs);
    return Response.json({
      ...dispatch,
      submitted_inputs: inputs,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Build dispatch failed" },
      { status: 400 },
    );
  }
}
