import React from 'react';
import type { MarkdownCaptureRequest } from '../../shared/types';
import { CaptureCard } from './components/capture/CaptureCard';

export const CapturePage: React.FC<{ request: MarkdownCaptureRequest }> = ({ request }) => (
  <CaptureCard request={request} rootId="capture-logical-root" />
);
