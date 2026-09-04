#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command } from 'commander';
import packageInfo from '../package.json';

const VERSION = packageInfo.version;
const DEFAULT_DIRECTORY = 'homeframe-app';
const TEMPLATE_ROOT = resolveTemplateRoot(import.meta.url);
const IGNORED_EXISTING_ENTRIES = new Set(['.DS_Store', '.git']);

export interface ScaffoldOptions {
  appName?: string;
  packageName?: string;
  install?: boolean;
}

export interface ScaffoldResult {
  root: string;
  appName: string;
  packageName: string;
  installed: boolean;
  files: string[];
}

export const program = new Command();
program
  .name('scaffold-homeframe-app')
  .description('Create a Homeframe React PWA with framework guardrails and an AI coder runbook.')
  .version(VERSION)
  .argument('[directory]', 'directory to create', DEFAULT_DIRECTORY)
  .option('--app-name <name>', 'display name used by the app and manifest')
  .option('--package-name <name>', 'npm package name for the generated application')
  .option('--no-install', 'write the project without running npm install')
  .action(async (directory: string, options: ScaffoldOptions) => {
    try {
      const result = await scaffoldProject(directory, options);
      printSuccess(result);
    } catch (reason) {
      console.error(`\nUnable to create the Homeframe app: ${message(reason)}`);
      process.exitCode = 1;
    }
  });

export async function scaffoldProject(
  directory = DEFAULT_DIRECTORY,
  options: ScaffoldOptions = {},
): Promise<ScaffoldResult> {
  const root = resolve(directory);
  await assertWritableTarget(root);

  const rawPackageName = options.packageName ?? basename(root);
  const packageName = normalizePackageName(rawPackageName);
  const appName = normalizeAppName(options.appName ?? titleFromPackageName(packageName));
  const replacements = templateReplacements(packageName, appName);
  const files = await copyTemplate(TEMPLATE_ROOT, root, replacements);
  const install = options.install !== false;

  if (install) await runNpmInstall(root);

  return { root, appName, packageName, installed: install, files };
}

export function isCliEntryPoint(moduleUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(argvPath));
  } catch {
    return moduleUrl === pathToFileURL(resolve(argvPath)).href;
  }
}

if (isCliEntryPoint(import.meta.url, process.argv[1])) await program.parseAsync();

async function assertWritableTarget(root: string): Promise<void> {
  if (!existsSync(root)) {
    await mkdir(root, { recursive: true });
    return;
  }

  const target = await stat(root);
  if (!target.isDirectory()) throw new Error(`${root} exists and is not a directory.`);
  const entries = (await readdir(root)).filter((entry) => !IGNORED_EXISTING_ENTRIES.has(entry));
  if (entries.length > 0) {
    throw new Error(`${root} is not empty. Choose a new directory or empty it before scaffolding.`);
  }
}

async function copyTemplate(
  sourceRoot: string,
  targetRoot: string,
  replacements: ReadonlyMap<string, string>,
): Promise<string[]> {
  const files: string[] = [];

  async function visit(sourceDirectory: string): Promise<void> {
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const source = join(sourceDirectory, entry.name);
      const templateRelativePath = relative(sourceRoot, source);
      const outputRelativePath = templateRelativePath
        .split(/[\\/]/)
        .map((part) => part === '_gitignore' ? '.gitignore' : part === '_npmrc' ? '.npmrc' : part)
        .join('/');
      const output = join(targetRoot, outputRelativePath);
      if (entry.isDirectory()) {
        await mkdir(output, { recursive: true });
        await visit(source);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Unsupported template entry: ${templateRelativePath}`);

      let contents = await readFile(source, 'utf8');
      for (const [token, value] of replacements) contents = contents.replaceAll(token, value);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, contents);
      files.push(outputRelativePath);
    }
  }

  await visit(sourceRoot);
  return files.sort();
}

function templateReplacements(packageName: string, appName: string): ReadonlyMap<string, string> {
  const initial = [...appName].find((character) => /[\p{Letter}\p{Number}]/u.test(character))?.toUpperCase() ?? 'H';
  return new Map([
    ['__HOMEFRAME_PACKAGE_NAME__', packageName],
    ['__HOMEFRAME_APP_NAME_JSON__', JSON.stringify(appName)],
    ['__HOMEFRAME_APP_NAME_HTML__', escapeHtml(appName)],
    ['__HOMEFRAME_APP_NAME_MARKDOWN__', appName.replace(/[\r\n]+/g, ' ')],
    ['__HOMEFRAME_APP_INITIAL__', escapeHtml(initial)],
  ]);
}

function normalizePackageName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
  const valid = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(normalized)
    && normalized.length <= 214
    && !normalized.includes('..');
  if (!valid) throw new Error(`Invalid npm package name: ${JSON.stringify(value)}.`);
  return normalized;
}

function normalizeAppName(value: string): string {
  const normalized = value.trim().replace(/[\r\n]+/g, ' ');
  if (!normalized) throw new Error('The app name cannot be empty.');
  if (normalized.length > 60) throw new Error('The app name must be 60 characters or fewer.');
  return normalized;
}

function titleFromPackageName(packageName: string): string {
  const unscoped = packageName.includes('/') ? packageName.slice(packageName.indexOf('/') + 1) : packageName;
  return unscoped
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ') || 'Homeframe App';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

async function runNpmInstall(root: string): Promise<void> {
  console.log(`\nInstalling dependencies in ${root}...`);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], {
      cwd: root,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`npm install exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}.`));
    });
  });
}

function printSuccess(result: ScaffoldResult): void {
  const displayRoot = relative(process.cwd(), result.root) || '.';
  console.log(`\nCreated ${result.appName} in ${result.root}`);
  console.log(`Generated ${result.files.length} files, including AGENTS.md and docs/HOMEFRAME_RUNBOOK.md.`);
  console.log('\nNext steps:');
  if (displayRoot !== '.') console.log(`  cd ${quoteShellArgument(displayRoot)}`);
  if (!result.installed) console.log('  npm install');
  console.log('  npm run dev');
  console.log('\nBefore shipping:');
  console.log('  npm run check');
  console.log('  npm run doctor');
}

function quoteShellArgument(value: string): string {
  return /^[a-zA-Z0-9_./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function resolveTemplateRoot(moduleUrl: string): string {
  if (moduleUrl.startsWith('file:')) return fileURLToPath(new URL('../template/', moduleUrl));
  const workspaceTemplate = resolve(process.cwd(), 'packages/scaffold/template');
  if (existsSync(workspaceTemplate)) return workspaceTemplate;
  throw new Error(`Unable to locate the scaffold template from ${moduleUrl}.`);
}
