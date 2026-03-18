#!/usr/bin/env python3
"""Helpers for catalog-driven GitHub Actions workflows."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "tools" / "catalog.yml"
PROFILE_DIR = ROOT / "tools" / "profiles"


def load_catalog() -> dict[str, Any]:
    tools = parse_catalog(CATALOG_PATH.read_text(encoding="utf-8"))
    if not isinstance(tools, list):
        raise SystemExit("Catalog must contain a top-level 'tools' list")

    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    normalized_tools = []

    for tool in tools:
        if not isinstance(tool, dict):
            raise SystemExit("Each catalog entry must be a mapping")

        tool_id = str(tool.get("id", "")).strip()
        repo_url = normalize_repo_url(str(tool.get("repo_url", "")).strip())

        if not tool_id:
            raise SystemExit("Catalog entry missing id")
        if not repo_url:
            raise SystemExit(f"Catalog entry '{tool_id}' missing repo_url")
        if tool_id in seen_ids:
            raise SystemExit(f"Duplicate catalog id: {tool_id}")
        if repo_url in seen_urls:
            raise SystemExit(f"Duplicate catalog repo_url: {repo_url}")

        seen_ids.add(tool_id)
        seen_urls.add(repo_url)

        normalized_tools.append(
            {
                "id": tool_id,
                "repo_url": repo_url,
                "enabled": bool(tool.get("enabled", True)),
                "project_path": str(tool.get("project_path", "") or ""),
                "asset_include": list(tool.get("asset_include", []) or []),
                "asset_exclude": list(tool.get("asset_exclude", []) or []),
                "default_configuration": str(
                    tool.get("default_configuration", "Release") or "Release"
                ),
                "default_framework": str(tool.get("default_framework", "") or ""),
                "version_strategy": str(
                    tool.get("version_strategy", "tag_then_commit") or "tag_then_commit"
                ),
                "default_ref": str(tool.get("default_ref", "") or ""),
                "restore_mode": str(tool.get("restore_mode", "auto") or "auto"),
                "build_mode": str(tool.get("build_mode", "auto") or "auto"),
                "notes": str(tool.get("notes", "") or ""),
            }
        )

    return {"tools": normalized_tools}


def parse_catalog(text: str) -> list[dict[str, Any]]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "tools:":
        raise SystemExit("Catalog must start with 'tools:'")

    items: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    current_list_key: str | None = None

    for raw_line in lines[1:]:
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if line.startswith("  - "):
            if current is not None:
                items.append(current)
            current = {}
            current_list_key = None
            rest = line[4:]
            if rest:
                key, value = parse_key_value(rest)
                current[key] = value
            continue

        if current is None:
            raise SystemExit("Invalid catalog structure")

        if line.startswith("      - "):
            if current_list_key is None:
                raise SystemExit("List item without a parent key")
            current.setdefault(current_list_key, []).append(parse_scalar(line[8:]))
            continue

        if line.startswith("    ") and not line.startswith("      "):
            key, value = parse_key_value(line[4:])
            if value is None:
                current[key] = []
                current_list_key = key
            else:
                current[key] = value
                current_list_key = None
            continue

        raise SystemExit(f"Unsupported catalog line: {line}")

    if current is not None:
        items.append(current)

    return items


def parse_key_value(text: str) -> tuple[str, Any]:
    if ":" not in text:
        raise SystemExit(f"Expected key/value pair: {text}")
    key, value = text.split(":", 1)
    key = key.strip()
    value = value.strip()
    if not key:
        raise SystemExit(f"Invalid key/value pair: {text}")
    if value == "":
        return key, None
    return key, parse_scalar(value)


def parse_scalar(value: str) -> Any:
    value = value.strip()
    if value.startswith(("'", '"')) and value.endswith(("'", '"')) and len(value) >= 2:
        return value[1:-1]
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    return value


def normalize_repo_url(repo_url: str) -> str:
    repo_url = repo_url.strip()
    if not repo_url:
        return ""

    ssh_match = re.fullmatch(r"git@github\.com:(.+?)(?:\.git)?", repo_url, re.IGNORECASE)
    if ssh_match:
        repo_url = f"https://github.com/{ssh_match.group(1)}"

    repo_url = repo_url.removesuffix(".git").rstrip("/")
    if repo_url.startswith("http://"):
        repo_url = "https://" + repo_url[len("http://") :]

    return repo_url


def github_slug(repo_url: str) -> str:
    match = re.fullmatch(r"https://github\.com/([^/]+)/([^/]+)", repo_url, re.IGNORECASE)
    if not match:
        raise SystemExit(f"Only github.com repos are supported: {repo_url}")
    return f"{match.group(1)}/{match.group(2)}"


def find_tool(data: dict[str, Any], *, tool_id: str = "", repo_url: str = "") -> dict[str, Any] | None:
    normalized_repo = normalize_repo_url(repo_url)
    for tool in data["tools"]:
        if tool_id and tool["id"] == tool_id:
            return tool
        if normalized_repo and tool["repo_url"] == normalized_repo:
            return tool
    return None


def emit_output(name: str, value: str) -> None:
    github_output = os.getenv("GITHUB_OUTPUT")
    line = f"{name}={value}"
    if github_output:
        with open(github_output, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    else:
        print(line)


def load_profile(tool_id: str) -> dict[str, Any]:
    if not tool_id:
        return {}

    path = PROFILE_DIR / f"{tool_id}.json"
    if not path.exists():
        return {}

    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    if not isinstance(data, dict):
        raise SystemExit(f"Profile must be a JSON object: {path}")

    return data


def apply_profile(tool: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    if not profile:
        return tool

    merged = dict(tool)

    if str(profile.get("repo_url", "") or "") not in ("", tool["repo_url"]):
        raise SystemExit(f"Profile repo_url mismatch for tool '{tool['id']}'")

    project_path = str(profile.get("project_path", "") or "")
    configuration = str(profile.get("configuration", "") or "")
    target_framework = str(profile.get("target_framework", "") or "")
    git_ref = str(profile.get("git_ref", "") or "")
    version_strategy = str(profile.get("version_strategy", "") or "")
    restore_mode = str(profile.get("restore_mode", "") or "")
    build_mode = str(profile.get("build_mode", "") or "")
    asset_include = profile.get("asset_include", [])
    asset_exclude = profile.get("asset_exclude", [])

    if project_path:
        merged["project_path"] = project_path
    if configuration:
        merged["default_configuration"] = configuration
    if target_framework:
        merged["default_framework"] = target_framework
    if git_ref:
        merged["default_ref"] = git_ref
    if version_strategy:
        merged["version_strategy"] = version_strategy
    if restore_mode:
        merged["restore_mode"] = restore_mode
    if build_mode:
        merged["build_mode"] = build_mode
    if isinstance(asset_include, list) and asset_include:
        merged["asset_include"] = [str(item) for item in asset_include]
    if isinstance(asset_exclude, list) and asset_exclude:
        merged["asset_exclude"] = [str(item) for item in asset_exclude]

    return merged


def command_list_enabled() -> int:
    data = load_catalog()
    enabled = []
    for tool in data["tools"]:
        if not tool["enabled"]:
            continue
        tool = apply_profile(tool, load_profile(tool["id"]))
        enabled.append(
            {
                "tool_id": tool["id"],
                "repo_url": tool["repo_url"],
                "project_path": tool["project_path"],
                "configuration": tool["default_configuration"],
                "target_framework": tool["default_framework"],
                "git_ref": tool["default_ref"],
                "version_strategy": tool["version_strategy"],
                "restore_mode": tool["restore_mode"],
                "build_mode": tool["build_mode"],
                "asset_include": ",".join(tool["asset_include"]),
                "asset_exclude": ",".join(tool["asset_exclude"]),
            }
        )

    payload = json.dumps({"include": enabled}, separators=(",", ":"))
    emit_output("matrix", payload)
    print(payload)
    return 0


def command_resolve(argv: list[str]) -> int:
    if len(argv) != 4:
        raise SystemExit("usage: resolve <mode> <tool_id> <repo_url>")

    _, _mode, tool_id, repo_url = argv
    data = load_catalog()
    normalized_repo = normalize_repo_url(repo_url)
    tool_from_id = find_tool(data, tool_id=tool_id)
    tool_from_repo = find_tool(data, repo_url=normalized_repo)

    if tool_from_id and normalized_repo and tool_from_id["repo_url"] != normalized_repo:
        raise SystemExit("tool_id and repo_url refer to different repositories")

    tool = tool_from_id or tool_from_repo
    if tool:
        tool = apply_profile(tool, load_profile(tool["id"]))
        repo_url_value = tool["repo_url"]
        tool_id_value = tool["id"]
        cataloged = "true"
        enabled = "true" if tool["enabled"] else "false"
        project_path = tool["project_path"]
        configuration = tool["default_configuration"]
        target_framework = tool["default_framework"]
        git_ref = tool["default_ref"]
        version_strategy = tool["version_strategy"]
        restore_mode = tool["restore_mode"]
        build_mode = tool["build_mode"]
        asset_include = ",".join(tool["asset_include"])
        asset_exclude = ",".join(tool["asset_exclude"])
    else:
        if not normalized_repo:
            raise SystemExit("repo_url is required for uncataloged repositories")
        repo_url_value = normalized_repo
        tool_id_value = github_slug(normalized_repo).split("/", 1)[1].lower()
        profile = load_profile(tool_id_value)
        cataloged = "false"
        enabled = "true"
        if str(profile.get("repo_url", "") or "") not in ("", repo_url_value):
            raise SystemExit(f"Profile repo_url mismatch for tool '{tool_id_value}'")
        project_path = str(profile.get("project_path", "") or "")
        configuration = str(profile.get("configuration", "Release") or "Release")
        target_framework = str(profile.get("target_framework", "") or "")
        git_ref = str(profile.get("git_ref", "") or "")
        version_strategy = str(profile.get("version_strategy", "tag_then_commit") or "tag_then_commit")
        restore_mode = str(profile.get("restore_mode", "auto") or "auto")
        build_mode = str(profile.get("build_mode", "auto") or "auto")
        asset_include = ",".join([str(item) for item in profile.get("asset_include", []) or []])
        asset_exclude = ",".join([str(item) for item in profile.get("asset_exclude", []) or []])

    emit_output("repo_url", repo_url_value)
    emit_output("tool_id", tool_id_value)
    emit_output("cataloged", cataloged)
    emit_output("enabled", enabled)
    emit_output("project_path", project_path)
    emit_output("configuration", configuration)
    emit_output("target_framework", target_framework)
    emit_output("git_ref", git_ref)
    emit_output("version_strategy", version_strategy)
    emit_output("restore_mode", restore_mode)
    emit_output("build_mode", build_mode)
    emit_output("asset_include", asset_include)
    emit_output("asset_exclude", asset_exclude)
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        raise SystemExit("usage: catalog_tool.py <list-enabled|resolve> ...")

    cmd = argv[1]
    if cmd == "list-enabled":
        return command_list_enabled()
    if cmd == "resolve":
        return command_resolve(argv[1:])
    raise SystemExit(f"Unknown command: {cmd}")


if __name__ == "__main__":
    sys.exit(main(sys.argv))
