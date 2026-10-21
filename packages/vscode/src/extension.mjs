// AI Project Kit — VS Code / Open VSX extension.
// Imports @bobrowsse-tech/ai-kit-core directly (never shells out to npx/node).
import path from 'node:path';
import * as vscode from 'vscode';
import {
  installKit,
  setAssetRoot,
  loadKitManifest,
  checkDocs,
  REQUIRED_DOCS,
} from '@bobrowsse-tech/ai-kit-core';

/** @type {vscode.DiagnosticCollection | undefined} */
let diagnostics;
/** @type {vscode.StatusBarItem | undefined} */
let statusBar;
/** @type {vscode.FileSystemWatcher | undefined} */
let docsWatcher;

/** @param {vscode.ExtensionContext} context */
export function activate(context) {
  const assetsDir = path.join(context.extensionPath, 'dist', 'assets');
  setAssetRoot(assetsDir);

  diagnostics = vscode.languages.createDiagnosticCollection('ai-kit-docs');
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'aiKit.checkDocs';
  statusBar.tooltip = 'AI Kit: Check Docs';
  statusBar.show();

  context.subscriptions.push(
    diagnostics,
    statusBar,
    vscode.commands.registerCommand('aiKit.initializeProject', () => runInstall({ update: false })),
    vscode.commands.registerCommand('aiKit.updateRules', () => runInstall({ update: true })),
    vscode.commands.registerCommand('aiKit.checkDocs', () => runCheckDocs({ notify: true })),
    vscode.commands.registerCommand('aiKit.openAgentsMd', openAgentsMd),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      refreshStatus();
      watchDocs(context);
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => refreshStatus()),
  );

  watchDocs(context);
  refreshStatus();
}

export function deactivate() {
  docsWatcher?.dispose();
}

/**
 * @param {{ update: boolean }} opts
 */
async function runInstall({ update }) {
  if (!vscode.workspace.isTrusted) {
    await vscode.window.showErrorMessage('AI Kit write commands require a trusted workspace.');
    return;
  }

  const folder = await pickFolder();
  if (!folder) return;

  const target = folder.uri.fsPath;
  const label = update ? 'Update Rules' : 'Initialize Project';
  const confirm = await vscode.window.showWarningMessage(
    update
      ? `Refresh AI Kit owned files in:\n${target}\n\nYour customized seeds (docs, config) stay untouched. Continue?`
      : `Install AI Kit into:\n${target}\n\nExisting kit-owned files you customized get a .kit-new side file; docs/config are never overwritten. Continue?`,
    { modal: true },
    'Continue',
  );
  if (confirm !== 'Continue') return;

  const lines = [];
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `AI Kit: ${label}`, cancellable: false },
    async () => installKit({
      target,
      update,
      noPost: true,
      io: {
        write: (line) => lines.push(String(line)),
        error: (line) => lines.push(String(line)),
      },
    }),
  );

  if (!result.ok) {
    await vscode.window.showErrorMessage(lines.filter(Boolean).join('\n') || 'AI Kit failed.');
    return;
  }

  const version = result.version || loadKitManifest().version;
  const summary = [
    `AI Kit ${version} ${update ? 'update' : 'install'} → ${target}`,
    `created: ${result.log.created.length}, updated: ${result.log.updated.length}, conflicts: ${result.log.conflicts.length}`,
    result.log.conflicts.length ? 'Review CONFLICT side files (*.kit-new / AGENTS.kit.md), then commit.' : 'Next: tell your agent to read AGENTS.md and run project-bootstrap.',
  ].join('\n');

  await vscode.window.showInformationMessage(summary);
  refreshStatus();
}

/**
 * @param {{ notify?: boolean }} [opts]
 */
async function runCheckDocs({ notify = false } = {}) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    if (notify) await vscode.window.showErrorMessage('Open a folder before checking AI Kit docs.');
    clearDiagnostics();
    if (statusBar) statusBar.text = 'AI Kit: no folder';
    return;
  }

  const root = folder.uri.fsPath;
  const report = checkDocs(root);
  publishDiagnostics(folder, report);
  refreshStatusBar(report);

  if (!notify) return;

  if (report.ok) {
    const todoNote = report.todo.length ? ` (${report.todo.length} still have TODO placeholders)` : '';
    await vscode.window.showInformationMessage(`AI Kit: ${report.present}/${report.total} docs present and non-empty${todoNote}.`);
    return;
  }

  const parts = [];
  if (report.missing.length) parts.push(`missing: ${report.missing.join(', ')}`);
  if (report.empty.length) parts.push(`empty: ${report.empty.join(', ')}`);
  await vscode.window.showWarningMessage(`AI Kit docs ${report.present}/${report.total}. ${parts.join('; ')}`);
}

/**
 * @param {vscode.WorkspaceFolder} folder
 * @param {ReturnType<typeof checkDocs>} report
 */
function publishDiagnostics(folder, report) {
  if (!diagnostics) return;
  diagnostics.clear();
  /** @type {Map<string, vscode.Diagnostic[]>} */
  const byFile = new Map();

  const add = (rel, message, severity) => {
    const uri = vscode.Uri.joinPath(folder.uri, ...rel.split('/'));
    const list = byFile.get(uri.toString()) || [];
    list.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), message, severity));
    byFile.set(uri.toString(), list);
  };

  for (const rel of report.missing) {
    add(rel, `AI Kit: required doc is missing (${rel}).`, vscode.DiagnosticSeverity.Error);
  }
  for (const rel of report.empty) {
    add(rel, `AI Kit: required doc is empty (${rel}).`, vscode.DiagnosticSeverity.Error);
  }
  for (const rel of report.todo) {
    add(rel, `AI Kit: doc still contains TODO placeholders (${rel}).`, vscode.DiagnosticSeverity.Warning);
  }

  for (const [uriStr, diags] of byFile) {
    diagnostics.set(vscode.Uri.parse(uriStr), diags);
  }
}

function clearDiagnostics() {
  diagnostics?.clear();
}

/** @param {ReturnType<typeof checkDocs>} [report] */
function refreshStatusBar(report) {
  if (!statusBar) return;
  if (!vscode.workspace.workspaceFolders?.length) {
    statusBar.text = 'AI Kit: no folder';
    return;
  }
  if (!report) {
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    report = checkDocs(root);
  }
  statusBar.text = `AI Kit: ${report.present}/${report.total} docs`;
  statusBar.backgroundColor = report.ok
    ? undefined
    : new vscode.ThemeColor('statusBarItem.warningBackground');
}

function refreshStatus() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    clearDiagnostics();
    refreshStatusBar();
    return;
  }
  const report = checkDocs(folder.uri.fsPath);
  publishDiagnostics(folder, report);
  refreshStatusBar(report);
}

/** @param {vscode.ExtensionContext} context */
function watchDocs(context) {
  docsWatcher?.dispose();
  docsWatcher = undefined;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  const pattern = new vscode.RelativePattern(folder, 'docs/**');
  docsWatcher = vscode.workspace.createFileSystemWatcher(pattern);
  const bump = () => refreshStatus();
  docsWatcher.onDidCreate(bump);
  docsWatcher.onDidChange(bump);
  docsWatcher.onDidDelete(bump);
  context.subscriptions.push(docsWatcher);
}

async function openAgentsMd() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    await vscode.window.showErrorMessage('Open a folder before opening AGENTS.md.');
    return;
  }
  const uri = vscode.Uri.joinPath(folder.uri, 'AGENTS.md');
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  } catch {
    await vscode.window.showWarningMessage('AGENTS.md not found — run AI Kit: Initialize Project first.');
  }
}

/** @returns {Promise<vscode.WorkspaceFolder | undefined>} */
async function pickFolder() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    await vscode.window.showErrorMessage('Open a folder or workspace before running AI Kit.');
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  return vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose the project folder for AI Kit' });
}

// Re-export for tests that import the module graph (optional).
export { REQUIRED_DOCS };
