import React, { useCallback, useState } from 'react';
import { Box, Code, Collapse, Group, Paper, Stack, Text } from '@mantine/core';
import { BookOpen, Check, ChevronDown, ChevronUp, Copy, ShieldAlert } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { AppTextInput } from '../../../components/AppTextInput';
import { CodeEditor } from '../../../components/CodeEditor';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import { clipboardApi } from '../../../api/electronApi';
import type { SkillConfigProps } from './types';

const HELPER_ROWS: { sig: string; key: string }[] = [
  { sig: 'await waitFor(sel, ms?)', key: 'agentflow.skill.browser_js.help.waitFor' },
  { sig: 'await fill(sel, value)', key: 'agentflow.skill.browser_js.help.fill' },
  { sig: 'click(sel)', key: 'agentflow.skill.browser_js.help.click' },
  { sig: 'read(sel)', key: 'agentflow.skill.browser_js.help.read' },
  { sig: 'readAll(sel)', key: 'agentflow.skill.browser_js.help.readAll' },
  { sig: 'await sleep(ms)', key: 'agentflow.skill.browser_js.help.sleep' },
  { sig: 'await screenshot(name?)', key: 'agentflow.skill.browser_js.help.screenshot' },
];

const BROWSER_JS_LLM_REFERENCE = [
  'You are writing the `code` for a Yobi AgentFlow "browser_js" step.',
  'It runs as JavaScript inside an already-open browser tab. You also have full',
  'document/window/DOM, fetch and async/await. Set the step output with `return <value>`',
  '(objects are JSON-stringified). All selectors are CSS selectors (#id, .class, [name="x"], tag).',
  '',
  'Injected helpers:',
  '- await waitFor(sel, ms?) — wait for the element to appear and return it (default 15000ms; throws on timeout).',
  '- await fill(sel, value) — set an input/textarea/password/contenteditable value (React-safe).',
  '- click(sel) — click a button/link/checkbox (native click + mouse sequence).',
  '- read(sel) — innerText of the first match, or "".',
  '- readAll(sel) — array of innerText for all matches.',
  '- await sleep(ms) — wait.',
  '- await screenshot(name?) — save a PNG of the page and return its file path.',
  '(await is required for waitFor/sleep/screenshot; optional on the others.)',
  '',
  'Example — log in (a submit that navigates: defer the click so the step returns first):',
  "await fill('#user', 'me');",
  "await fill('#pass', 'secret');",
  "setTimeout(function () { document.querySelector('#submit').click(); }, 50);",
  "return 'submitted';",
  '',
  'Example — scrape a list into an array (feed a following loop, {{item.title}}/{{item.link}}):',
  "var rows = document.querySelectorAll('.list .item');",
  'return JSON.stringify(Array.prototype.map.call(rows, function (el) {',
  "  return { title: el.querySelector('.title').innerText, link: el.querySelector('a').href };",
  '}));',
  '',
  'Now write the code for this task: <describe what to do>',
].join('\n');

export const BrowserJsConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const [helpOpen, setHelpOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await clipboardApi.copyText(BROWSER_JS_LLM_REFERENCE);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_200);
  }, []);

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('agentflow.skill.browser_js.page')}
        placeholder={t('agentflow.skill.browser_js.page.placeholder')}
        value={step.config.page ?? ''}
        onChange={(e) => onChange({ ...step.config, page: e.currentTarget.value })}
        size="sm"
        mono
      />

      <Box>
        <Group justify="space-between" align="center" mb={4} wrap="nowrap">
          <Text fz="sm" fw={500}>{t('agentflow.skill.browser_js.code')}</Text>
          <AppButton
            variant="subtle"
            size="xs"
            leftSection={<BookOpen size={13} />}
            rightSection={helpOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            onClick={() => setHelpOpen((v) => !v)}
          >
            {t('agentflow.skill.browser_js.helpers')}
          </AppButton>
        </Group>

        <CodeEditor
          value={step.config.code ?? ''}
          onChange={(v) => onChange({ ...step.config, code: v })}
          placeholder={t('agentflow.skill.browser_js.code.placeholder')}
          ariaLabel={t('agentflow.skill.browser_js.code')}
        />
        <Text fz="xs" c="dimmed" mt={4}>{t('agentflow.skill.browser_js.formatHint')}</Text>
      </Box>

      <Collapse expanded={helpOpen}>
        <Paper withBorder p="xs" radius="sm">
          <Stack gap={6}>
            <Text fz="xs" c="dimmed">{t('agentflow.skill.browser_js.help.selectors')}</Text>
            {HELPER_ROWS.map((row) => (
              <Group key={row.sig} gap={8} wrap="nowrap" align="flex-start">
                <Code style={{ flexShrink: 0 }}>{row.sig}</Code>
                <Text fz="xs" c="dimmed">{t(row.key)}</Text>
              </Group>
            ))}
            <Text fz="xs" c="dimmed">{t('agentflow.skill.browser_js.help.return')}</Text>
            <AppButton
              variant="light"
              size="xs"
              leftSection={copied ? <Check size={13} /> : <Copy size={13} />}
              onClick={() => void handleCopy()}
            >
              {copied ? t('agentflow.skill.browser_js.help.copied') : t('agentflow.skill.browser_js.help.copy')}
            </AppButton>
          </Stack>
        </Paper>
      </Collapse>

      <SettingRow
        icon={<ShieldAlert size={13} />}
        label={t('agentflow.skill.browser_js.emitFailFlag')}
        hint={t('agentflow.skill.browser_js.emitFailFlag.hint')}
        control={
          <ToggleSwitch
            checked={step.config.emitFailFlag === 'true'}
            onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />

      <Text fz="xs" c="dimmed">
        {t('agentflow.skill.browser_js.outputHint').split('{{outputKey}}').join(`{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
