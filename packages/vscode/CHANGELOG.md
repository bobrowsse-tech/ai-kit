# Changelog

## 0.1.2

Changed
- **Initialize Project** and **Update Rules** install kit 1.7.0. A project can opt into sister repos (briefs, contract gaps, and handoffs). Azure commands that print keys are blocked; ordinary reads still run.

## 0.1.1

Fixed
- The Marketplace and Open VSX listing banner loads from `packages/vscode/media/banner.png`.

## 0.1.0

Added
- First extension release (pre-release channel).
- Commands: **Initialize Project**, **Update Rules**, **Check Docs**, **Open AGENTS.md**.
- Status bar docs health (`AI Kit: N/12 docs`) with a `docs/` file watcher.
- Getting-started walkthrough.
- Limited Workspace Trust support (write commands require trust).
