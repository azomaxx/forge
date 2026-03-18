import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  context.locals.runtime = context.locals.runtime ?? context.locals.cloudflare;

  if (
    pathname.startsWith("/_astro/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/" ||
    pathname.startsWith("/results") ||
    pathname.startsWith("/runs") ||
    pathname.startsWith("/api/releases") ||
    pathname.startsWith("/api/runs")
  ) {
    return next();
  }

  return next();
});
