import { Badge } from '@mantine/core';
import styles from './ProviderTag.module.css';

interface ProviderTagProps {
  provider: string;
  selected?: boolean;
}

/** The provider name on a conversation ("Gemini", "Claude"…): the one badge that stays a pill. */
export function ProviderTag({ provider, selected = false }: ProviderTagProps) {
  return (
    <Badge
      variant="outline"
      size="s"
      radius="xl"
      fz="var(--font-size-sm)"
      lh={1.6}
      px={6}
      py={1}
      data-selected={String(selected)}
      className={styles.tag}
    >
      {provider}
    </Badge>
  );
}
