export type ForgeProfile = {
  tool_id: string;
  repo_url: string;
  project_path?: string;
  configuration?: string;
  target_framework?: string;
  git_ref?: string;
  version_strategy?: string;
  restore_mode?: string;
  build_mode?: string;
  asset_include?: string[];
  asset_exclude?: string[];
};

export type ForgeCatalogEntry = {
  id: string;
  repo_url: string;
  enabled: boolean;
  project_path?: string;
  default_configuration?: string;
  default_framework?: string;
  default_ref?: string;
  version_strategy?: string;
};

export type GitHubRepoRef = {
  name: string;
  kind: "tag" | "branch" | "commit";
};
