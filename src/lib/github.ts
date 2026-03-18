import type { APIContext } from "astro";
import { buildCatalogSuggestion, deriveToolId, findCatalogEntryByRepo, getProfileForRepo, normalizeRepoUrl } from "./forge-data";
import { getRequiredEnv, sleep } from "./runtime";
import type { GitHubRepoRef } from "./types";

type GitHubReleaseAsset = {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
};

type GitHubRelease = {
  id: number;
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GitHubReleaseAsset[];
};

function getForgeRepo(context: APIContext): string {
  return getRequiredEnv(context, "FORGE_GITHUB_REPO");
}

function getForgeBranch(context: APIContext): string {
  return getRequiredEnv(context, "FORGE_GITHUB_REF");
}

function getToken(context: APIContext): string {
  return getRequiredEnv(context, "FORGE_GITHUB_TOKEN");
}

async function githubRequest<T>(
  context: APIContext,
  path: string,
  init: RequestInit = {},
  accept = "application/vnd.github+json",
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${getToken(context)}`,
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

function parseGitHubRepo(repoUrl: string): { owner: string; repo: string; normalized: string } {
  const normalized = normalizeRepoUrl(repoUrl);
  const match = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!match) throw new Error("Repository URL must be a github.com repository");
  return { owner: match[1], repo: match[2], normalized };
}

export async function inspectRepository(context: APIContext, repoUrl: string) {
  const { owner, repo, normalized } = parseGitHubRepo(repoUrl);
  const repoData = await githubRequest<{ default_branch: string; full_name: string }>(
    context,
    `/repos/${owner}/${repo}`,
  );
  const tags = await githubRequest<Array<{ name: string }>>(context, `/repos/${owner}/${repo}/tags?per_page=20`);
  const branches = await githubRequest<Array<{ name: string }>>(context, `/repos/${owner}/${repo}/branches?per_page=10`);
  const commits = await githubRequest<Array<{ sha: string }>>(context, `/repos/${owner}/${repo}/commits?per_page=12`);
  const profile = getProfileForRepo(normalized);
  const catalogEntry = findCatalogEntryByRepo(normalized);

  const refs: GitHubRepoRef[] = [
    ...tags.map((tag) => ({ name: tag.name, kind: "tag" as const })),
    ...branches.map((branch) => ({ name: branch.name, kind: "branch" as const })),
    ...commits.map((commit) => ({ name: commit.sha.slice(0, 12), kind: "commit" as const })),
  ];

  return {
    repo_url: normalized,
    default_branch: repoData.default_branch,
    refs,
    profile,
    catalog_match: catalogEntry
      ? {
          tool_id: catalogEntry.id,
          enabled: catalogEntry.enabled,
        }
      : null,
    tool_id: catalogEntry?.id ?? deriveToolId(normalized),
    catalog_suggestion: buildCatalogSuggestion(normalized),
  };
}

export async function dispatchBuild(context: APIContext, payload: Record<string, string | boolean>) {
  const repo = getForgeRepo(context);
  const workflowFile = "forge-build.yml";
  const startedAt = new Date().toISOString();

  await githubRequest<void>(context, `/repos/${repo}/actions/workflows/${workflowFile}/dispatches`, {
    method: "POST",
    body: JSON.stringify({
      ref: getForgeBranch(context),
      inputs: payload,
    }),
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await sleep(1200 * (attempt + 1));
    const runs = await githubRequest<{ workflow_runs: Array<{ id: number; created_at: string; html_url: string; status: string; conclusion: string | null }> }>(
      context,
      `/repos/${repo}/actions/workflows/${workflowFile}/runs?event=workflow_dispatch&per_page=10`,
    );
    const match = runs.workflow_runs.find((run) => run.created_at >= startedAt);
    if (match) {
      return {
        run_id: match.id,
        html_url: match.html_url,
        status: match.status,
        conclusion: match.conclusion,
      };
    }
  }

  return {
    run_id: null,
    html_url: null,
    status: "queued",
    conclusion: null,
  };
}

export async function getRun(context: APIContext, runId: string) {
  const repo = getForgeRepo(context);
  const run = await githubRequest<any>(context, `/repos/${repo}/actions/runs/${runId}`);
  const jobs = await githubRequest<{ jobs: any[] }>(context, `/repos/${repo}/actions/runs/${runId}/jobs?per_page=50`);
  return {
    id: run.id,
    name: run.name,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    html_url: run.html_url,
    created_at: run.created_at,
    updated_at: run.updated_at,
    jobs: jobs.jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      started_at: job.started_at,
      completed_at: job.completed_at,
      steps: (job.steps ?? []).map((step: any) => ({
        name: step.name,
        status: step.status,
        conclusion: step.conclusion,
      })),
    })),
  };
}

export async function listForgeReleases(context: APIContext, repoUrl: string) {
  const repo = getForgeRepo(context);
  const releases = await githubRequest<GitHubRelease[]>(context, `/repos/${repo}/releases?per_page=50`);
  const filtered = repoUrl
    ? releases.filter((release) => {
        const toolId = findCatalogEntryByRepo(repoUrl)?.id ?? deriveToolId(repoUrl);
        return release.tag_name.startsWith(`tool/${toolId}/`);
      })
    : releases.filter((release) => release.tag_name.startsWith("tool/"));
  
  // Sort by date (newest first) and limit to 20 most recent
  const sorted = filtered
    .sort((a, b) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime())
    .slice(0, 20);
    
  return sorted
    .map((release) => ({
      tag: release.tag_name,
      name: release.name,
      published_at: release.published_at,
      assets: release.assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        size: asset.size,
      })),
    }));
}

export async function streamReleaseAsset(context: APIContext, tag: string, assetName: string): Promise<Response> {
  const repo = getForgeRepo(context);
  const release = await githubRequest<GitHubRelease>(context, `/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  const asset = release.assets.find((item) => item.name === assetName);
  if (!asset) return new Response("Asset not found", { status: 404 });

  const response = await fetch(`https://api.github.com/repos/${repo}/releases/assets/${asset.id}`, {
    headers: {
      Accept: "application/octet-stream",
      Authorization: `Bearer ${getToken(context)}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
      "Content-Disposition": response.headers.get("content-disposition") ?? `attachment; filename="${asset.name}"`,
    },
  });
}
