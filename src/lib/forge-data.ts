import catalogRaw from "../../tools/catalog.yml?raw";
import type { ForgeCatalogEntry, ForgeProfile } from "./types";

const profileModules = import.meta.glob<{ default: ForgeProfile }>(
  "../../tools/profiles/*.json",
  { eager: true },
);

function parseScalar(value: string): string | boolean {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseCatalogYaml(text: string): ForgeCatalogEntry[] {
  const lines = text.split(/\r?\n/);
  const entries: ForgeCatalogEntry[] = [];
  let current: Record<string, unknown> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#") || stripped === "tools:") continue;

    if (line.startsWith("  - ")) {
      if (current) entries.push(current as ForgeCatalogEntry);
      current = {};
      const rest = line.slice(4);
      if (rest) {
        const [key, ...valueParts] = rest.split(":");
        current[key.trim()] = parseScalar(valueParts.join(":"));
      }
      continue;
    }

    if (!current) continue;
    if (line.startsWith("    ")) {
      const [key, ...valueParts] = line.trim().split(":");
      current[key.trim()] = parseScalar(valueParts.join(":"));
    }
  }

  if (current) entries.push(current as ForgeCatalogEntry);
  return entries.map((entry) => ({
    id: String(entry.id ?? ""),
    repo_url: normalizeRepoUrl(String(entry.repo_url ?? "")),
    enabled: Boolean(entry.enabled ?? true),
    project_path: String(entry.project_path ?? ""),
    default_configuration: String(entry.default_configuration ?? "Release"),
    default_framework: String(entry.default_framework ?? ""),
    default_ref: String(entry.default_ref ?? ""),
    version_strategy: String(entry.version_strategy ?? "tag_then_commit"),
  }));
}

export const catalog = parseCatalogYaml(catalogRaw);

export const profiles: Record<string, ForgeProfile> = Object.fromEntries(
  Object.entries(profileModules).map(([path, module]) => {
    const file = path.split("/").pop() ?? "";
    const toolId = file.replace(/\.json$/i, "");
    return [toolId, module.default];
  }),
);

export function normalizeRepoUrl(repoUrl: string): string {
  let normalized = repoUrl.trim();
  if (!normalized) return "";
  normalized = normalized.replace(/^http:\/\//i, "https://");
  normalized = normalized.replace(/\.git$/i, "");
  normalized = normalized.replace(/\/+$/, "");
  const ssh = normalized.match(/^git@github\.com:(.+)$/i);
  if (ssh) normalized = `https://github.com/${ssh[1]}`;
  return normalized;
}

export function deriveToolId(repoUrl: string): string {
  const normalized = normalizeRepoUrl(repoUrl);
  const parts = normalized.split("/");
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

export function findCatalogEntryByRepo(repoUrl: string): ForgeCatalogEntry | undefined {
  const normalized = normalizeRepoUrl(repoUrl);
  return catalog.find((entry) => entry.repo_url === normalized);
}

export function getProfileForRepo(repoUrl: string): ForgeProfile | undefined {
  const catalogEntry = findCatalogEntryByRepo(repoUrl);
  if (catalogEntry && profiles[catalogEntry.id]) return profiles[catalogEntry.id];
  const derived = deriveToolId(repoUrl);
  return profiles[derived];
}

export function buildCatalogSuggestion(repoUrl: string): string {
  const normalized = normalizeRepoUrl(repoUrl);
  const id = deriveToolId(normalized);
  return [
    "- id: " + id,
    `  repo_url: ${normalized}`,
    "  enabled: true",
    "  default_configuration: Release",
    "  version_strategy: tag_then_commit",
  ].join("\n");
}
