/**
 * The Office documents connector: OfficeCLI's own MCP server (`officecli mcp`, the author's code,
 * run as a child process) behind an in-process server of Yobi's that checks every call first
 * (`officeCommand.ts`). Loaded lazily by the registry.
 */
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OFFICE_TOOL_MISSING_ERROR } from '../../shared/builtinConnectors';
import { getOutputDir } from '../files';
import {
  agentNamedFolders, denyReasonForFileTool, getAgentFileRoots, getAgentWriteRoots, isWithinRootsReal, resolveAgentReadPath,
} from '../flow/agent/agentSandbox';
import { RelayedToolResult, ToolError, connectInProcess, createToolServer, type InProcessConnection } from '../mcp/inProcessServer';
import { resolveTool, toolRunEnv, toolSpec } from '../managedTools';
import { writeFileAtomic } from '../atomicWrite';
import { OFFICE_CALL_TIMEOUT_MS } from './officeAvailability';
import { printOfficeHtmlFile } from '../pdf/officeHtmlPrint';
import { OFFICE_TOOL_NAME, checkOfficeCommand, loadSkillCall, officeSkillPage } from './officeCommand';
import type { OfficePathPolicy } from './officeCommand';
import { sandboxedText } from './officeText';

const READ_DENIAL = (asked: string): string =>
  `access denied: "${asked}" is outside the folders this agent may read (the app output folder, Documents, Downloads, Desktop, and chat-media). Do not retry it or a variation of it — ask the user to place the file in one of those folders.`;
const WRITE_DENIAL = (asked: string): string =>
  `access denied: this would write "${asked}". This tool writes only inside the app output folder: give a plain file name (e.g. report.xlsx) and tell the user where it is. A file in Documents, Downloads, Desktop or chat-media can be read, not changed: create the edited copy under a new name in the output folder.`;

async function policyFor(): Promise<OfficePathPolicy> {
  const readRoots = await getAgentFileRoots();
  const writeRoots = await getAgentWriteRoots();
  return {
    platform: process.platform,
    resolve: (word) => resolveAgentReadPath(word),
    checkRead: async (abs, asked) => ((await denyReasonForFileTool('file_read', { path: abs }, readRoots)) ? READ_DENIAL(asked) : null),
    checkWrite: async (abs, asked) => {
      // A credential-looking name is refused even in the output folder, as for reads.
      if (await denyReasonForFileTool('file_read', { path: abs }, readRoots)) return WRITE_DENIAL(asked);
      return (await isWithinRootsReal(abs, writeRoots)) ? null : WRITE_DENIAL(asked);
    },
    isRootDir: (segment) => /^[\w.-]+$/.test(segment) && existsSync(path.posix.join('/', segment)),
  };
}

const PDF_OUT_MISSING = 'invalid command: name the PDF to write, e.g. ["view","report.docx","pdf","--out","report.pdf"].';

function textOnlyError(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * `view <file> pdf --out x.pdf`: OfficeCLI writes the document as HTML to a private temp file,
 * Yobi prints that to the checked PDF path (see `officePdf.ts`). Failures come back as the
 * tool's own error text, so the model reads them like any other call.
 */
async function printOfficePdf(upstream: Client, document: string, out: string, signal: AbortSignal | undefined): Promise<CallToolResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yobi-office-pdf-'));
  const html = path.join(dir, 'document.html');
  try {
    const rendered = (await upstream.callTool(
      { name: OFFICE_TOOL_NAME, arguments: { command: ['view', document, 'html', '--out', html] } },
      undefined,
      { signal, timeout: OFFICE_CALL_TIMEOUT_MS },
    )) as CallToolResult;
    if (rendered.isError === true || !existsSync(html)) return rendered.isError === true ? rendered : textOnlyError('Error: the document could not be rendered for PDF.');
    try {
      await writeFileAtomic(out, await printOfficeHtmlFile(html, signal));
    } catch (err) {
      return textOnlyError(`Error: PDF printing failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { content: [{ type: 'text', text: `Wrote ${out}` }] };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function connectOfficeMcp(clientName: string, clientVersion: string): Promise<InProcessConnection> {
  const copy = await resolveTool('officecli');
  if (!copy) throw new Error(OFFICE_TOOL_MISSING_ERROR);
  const outputDir = await getOutputDir();
  const upstream = new Client({ name: clientName, version: clientVersion });
  // The output folder is the working folder, so a bare file name lands where the agent may write.
  const transport = new StdioClientTransport({
    command: copy.path,
    args: ['mcp'],
    env: toolRunEnv(toolSpec('officecli'), copy.source),
    cwd: outputDir,
    stderr: 'ignore',
  });
  await upstream.connect(transport);
  const closeUpstream = async (): Promise<void> => {
    await upstream.close().catch(() => undefined);
  };
  let tool;
  try {
    tool = (await upstream.listTools()).tools.find((t) => t.name === OFFICE_TOOL_NAME);
  } catch (err) {
    await closeUpstream();
    throw err;
  }
  if (!tool) {
    await closeUpstream();
    throw new Error(`OfficeCLI ${copy.version} offers no "${OFFICE_TOOL_NAME}" tool`);
  }

  const server = createToolServer({
    name: 'office',
    tools: [tool],
    dispatch: async (toolName, args, signal) => {
      if (toolName !== OFFICE_TOOL_NAME) throw new ToolError('UnknownTool', `unknown tool: ${toolName}`);
      const checked = await checkOfficeCommand(args.command, await policyFor());
      if ('denied' in checked) return new RelayedToolResult(textOnlyError(checked.denied));
      if (checked.ok.pdfOf) {
        const out = checked.ok.writes.find((file) => /\.pdf$/i.test(file));
        if (!out) return new RelayedToolResult(textOnlyError(PDF_OUT_MISSING));
        const result = await printOfficePdf(upstream, checked.ok.pdfOf, out, signal);
        const roots = await agentNamedFolders();
        const content = (result.content ?? []).map((item) => (item.type === 'text' ? { ...item, text: sandboxedText(item.text, roots, process.platform) } : item));
        return new RelayedToolResult({ ...result, content }, result.isError === true || !existsSync(out) ? [] : [out]);
      }
      const result = (await upstream.callTool(
        { name: OFFICE_TOOL_NAME, arguments: { command: checked.ok.argv } },
        undefined,
        { signal, timeout: OFFICE_CALL_TIMEOUT_MS },
      )) as CallToolResult;
      // The folders a tool answer may name, as the model knows them: never the account's own path.
      const roots = await agentNamedFolders();
      const { skillPage } = checked.ok;
      if (skillPage !== undefined) {
        const text = (result.content ?? []).map((item) => (item.type === 'text' ? item.text : '')).join('');
        const paged = officeSkillPage(text, skillPage, (page) => loadSkillCall(checked.ok.argv, page));
        return new RelayedToolResult({ ...result, content: [{ type: 'text', text: sandboxedText(paged, roots, process.platform) }] });
      }
      const content = (result.content ?? []).map((item) => (item.type === 'text' ? { ...item, text: sandboxedText(item.text, roots, process.platform) } : item));
      const written = result.isError === true ? [] : checked.ok.writes.filter((file) => existsSync(file));
      return new RelayedToolResult({ ...result, content }, written);
    },
  });
  const connection = await connectInProcess(server, clientName, clientVersion);
  return {
    client: connection.client,
    close: async () => {
      await connection.close();
      await closeUpstream();
    },
  };
}
