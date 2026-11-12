import React, { useState } from 'react';
import { Alert, Group, Stack, Text } from '@mantine/core';
import { MessageCircleQuestionMark } from 'lucide-react';
import { AppButton } from '../../../../components/AppButton';
import { AppTextarea } from '../../../../components/AppTextarea';
import { SKILL_DRAFT_REQUEST_MAX } from '../../../../../../shared/skillAuthoring';

interface Props {
  questions: readonly string[];
  busy: boolean;
  onAnswer: (answers: string[]) => void;
  /** "Write it with your assumptions": the AI decides every question itself. */
  onAssume: () => void;
  t: (key: string) => string;
}

/**
 * The draft's questions, asked once: only what the skill cannot be written right without. A
 * question left blank is decided by the AI.
 */
export const SkillQuestions: React.FC<Props> = ({ questions, busy, onAnswer, onAssume, t }) => {
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''));
  const answered = answers.some((answer) => answer.trim());
  return (
    <Alert color="brand" variant="light" icon={<MessageCircleQuestionMark size={16} />} p="sm" title={t('settings.skills.questions.title')}>
      <Stack gap={10}>
        {questions.map((question, index) => (
          <Stack key={question} gap={4}>
            <Text fz="var(--font-size-sm)" lh={1.6} c="var(--text-primary)">{`${index + 1}. ${question}`}</Text>
            <AppTextarea
              value={answers[index] ?? ''}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setAnswers((current) => current.map((entry, at) => (at === index ? value : entry)));
              }}
              placeholder={t('settings.skills.questions.placeholder')}
              aria-label={question}
              maxLength={SKILL_DRAFT_REQUEST_MAX}
              autosize
              minRows={1}
              maxRows={4}
              disabled={busy}
            />
          </Stack>
        ))}
        <Group justify="flex-end" gap={8}>
          <AppButton variant="default" size="xs" disabled={busy} onClick={onAssume}>{t('settings.skills.questions.assume')}</AppButton>
          <AppButton size="xs" loading={busy} disabled={!answered} onClick={() => onAnswer(answers)}>{t('settings.skills.questions.answer')}</AppButton>
        </Group>
      </Stack>
    </Alert>
  );
};
