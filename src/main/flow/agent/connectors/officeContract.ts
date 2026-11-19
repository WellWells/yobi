import { commandArgv, verbAccess } from '../../../office/officeCommand';
import { interpretGeneric } from '../toolContracts';
import type { ToolContract, ToolRisk } from '../toolContracts';

/*
 * The Office connector has one tool whose command line says what it does, so its risk is read off
 * the verb: view/get/query and the like read; create/set/add/remove/... change a file. No call is
 * ever confirmed or held back by the run's declared intent: `officeCommand.ts` lets a change land
 * only in the output folder, and a file the user attached is edited as a copy there, so the worst
 * a call can do is spoil Yobi's own copy. Asking before each `add`, or holding a `create` because
 * the run had declared only a draft, turned building one document into a string of questions.
 * A verb Yobi does not let through is refused before it runs, so it never needs a risk of its own.
 */

function riskOf(args: Record<string, unknown>): ToolRisk {
  const argv = commandArgv(args.command);
  if (!argv) return 'mutating';
  return verbAccess(argv[0]) === 'read' ? 'read' : 'mutating';
}

const OFFICECLI: ToolContract = {
  risk: riskOf,
  boundary: () => null,
  confirm: () => 'never',
  interpret: (text, isError) => interpretGeneric(text, isError, 'officecli'),
  label: (args) => {
    const argv = commandArgv(args.command);
    return argv ? `officecli ${argv.slice(0, 2).join(' ')}` : 'officecli';
  },
  titleKey: 'agent.tool.office.officecli',
};

export const OFFICE_CONTRACTS: Readonly<Record<string, ToolContract>> = { officecli: OFFICECLI };

/**
 * What the tool's own description cannot say: how to fit a whole document in a few calls, where
 * files are and what comes back. Facts only; paid for in the shared connector catalog budget.
 */
export const OFFICE_NOTES = [
  'OFFICE NOTES:',
  '- officecli works on .docx, .xlsx and .pptx (CSV/TSV: import into an .xlsx). Run "help <format>" before a verb you have not used.',
  '- Give "command" as a JSON array of words, one array item per argument, so a value with spaces stays whole: ["add","a.docx","/body","--type","paragraph","--prop","font=Microsoft JhengHei"].',
  '- Write a document in a few calls, never a paragraph per call: ["create","a.docx"]; set the body font, size and colour ONCE on the style, not on every paragraph: ["set","a.docx","/styles/Normal","--prop","font.ea=Microsoft JhengHei","--prop","size=11pt"]; then ["batch","a.docx","--commands",[{"command":"add","parent":"/body","type":"paragraph","props":{"text":"Title","style":"Heading1"}}, …]] — the array itself, not a string. A reply has a length limit: put at most about 20 paragraphs in one batch and send the rest in the next.',
  '- PDF, HTML or a picture of a document: ["view","a.docx","pdf","--out","a.pdf"] (html / screenshot likewise).',
  '- Before creating a new document, deck or workbook (not for a small edit), load its officecli skill once and follow its design rules and checks: ["load_skill"] lists the skills and when each fits, ["load_skill","pptx"] loads one. A long one comes in pages: read every page ("--page","2", …) before you start; a file it lists: ["load_skill","morph-ppt","--path","reference/styles/INDEX.md"].',
  '- Skills are written for a terminal: run each command they show through this tool as a word array, and a heredoc batch as "--commands". Here watch, install, plugins and the skills\' .sh / .py helpers are not available.',
  '- You cannot see pictures this tool returns: for a skill\'s visual check use its no-vision path (view html, view issues, view text) and say what was not visually verified.',
  '- Chinese, Japanese or Korean text: the skills\' font tables are Latin-only. In .docx and .pptx also set font.ea to a font of that script (Windows: Microsoft JhengHei, Microsoft YaHei, Yu Gothic, Malgun Gothic; macOS: PingFang TC, PingFang SC, Hiragino Sans, Apple SD Gothic Neo); in .xlsx set font to it.',
  '- Files the user attached are listed under ATTACHED FILES; edit those copies by the names given. A file you wrote earlier in this conversation is still in the output folder under its plain name: edit that one, never a chat-media/ copy. A file elsewhere (Documents/…, chat-media/…) can be read but not changed: write the result under a new name in the output folder (a plain file name).',
  '- Every file a change or --out writes goes back to the user with the answer. Do not ask them to download it.',
].join('\n');
