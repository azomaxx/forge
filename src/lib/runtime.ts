import type { APIContext } from "astro";

type RuntimeEnv = Record<string, string | undefined>;

export function getRuntimeEnv(source: APIContext | App.Locals): RuntimeEnv {
  const candidate =
    ("locals" in source ? source.locals : source).runtime?.env ??
    ("locals" in source ? source.locals : source).cloudflare?.env ??
    {};
  return {
    ...(typeof process !== "undefined" ? (process.env as RuntimeEnv) : {}),
    ...(candidate as RuntimeEnv),
  };
}

export function getRequiredEnv(source: APIContext | App.Locals, name: string): string {
  const value = getRuntimeEnv(source)[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

declare global {
  namespace App {
    interface Locals {
      auth: {
        isAuthenticated: boolean;
      };
      runtime?: {
        env?: RuntimeEnv;
      };
      cloudflare?: {
        env?: RuntimeEnv;
      };
    }
  }
}
