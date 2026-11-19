import React, { useEffect, useRef, useState } from 'react';
import { Box, Image, Loader, Stack, Text } from '@mantine/core';
import { knowledgeApi } from '../../api/electronApi';
import type { KnowledgeFile, KnowledgeFilePreview as Preview } from '../../../../shared/knowledgeStatus';
import { fillTemplate } from '../../../../shared/fillTemplate';

/** Pages offered for a PDF's preview; the rest is one click away in the default app. */
export const PDF_PREVIEW_PAGES = 30;
/**
 * A file the selection only passes over (arrow keys, shift-click, a click on the next row) is not
 * read or drawn: the preview waits this long for the selection to stay on it.
 */
export const PREVIEW_SETTLE_MS = 150;
/** A page is drawn when it comes this close to the panel's visible part. */
const PAGE_DRAW_MARGIN = '600px 0px';
/** A width that changes (the panel dragged wider) redraws the pages once it holds still this long. */
const RESIZE_SETTLE_MS = 200;
const TEXT_STYLE: React.CSSProperties = { whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 };
const PAGE_STYLE: React.CSSProperties = { border: '1px solid var(--mantine-color-default-border)', background: '#fff', display: 'block', width: '100%' };

type PdfDocument = Awaited<ReturnType<typeof import('unpdf')['getDocumentProxy']>>;

interface PdfState {
  pdf: PdfDocument | null;
  /** Page 1's height over its width: the shape every page holds until it is drawn. */
  ratio: number;
  failed: boolean;
}

/**
 * Opens a PDF for its preview. `unpdf` (PDF.js) is loaded only here, on the first PDF preview —
 * never on the app's startup path. PDF.js runs on this thread, so nothing is drawn here: each page
 * draws itself when it scrolls near (`PdfPage`).
 */
function usePdfDocument(data: Uint8Array | null): PdfState {
  const [state, setState] = useState<PdfState>({ pdf: null, ratio: 0, failed: false });
  useEffect(() => {
    if (!data) return undefined;
    let live = true;
    let doc: PdfDocument | null = null;
    setState({ pdf: null, ratio: 0, failed: false });
    void (async () => {
      const { getDocumentProxy, registerImageDecoders } = await import('unpdf');
      registerImageDecoders();
      // PDF.js takes the buffer over: hand it a copy so a re-render can open the same bytes again.
      const opened = await getDocumentProxy(data.slice());
      if (!live) {
        void opened.loadingTask.destroy();
        return;
      }
      doc = opened;
      const first = (await opened.getPage(1)).getViewport({ scale: 1 });
      if (live) setState({ pdf: opened, ratio: first.height / first.width, failed: false });
    })().catch(() => { if (live) setState((current) => ({ ...current, failed: true })); });
    return () => {
      live = false;
      if (doc) void doc.loadingTask.destroy();
    };
  }, [data]);
  return state;
}

interface PdfPageProps {
  pdf: PdfDocument;
  number: number;
  width: number;
  ratio: number;
  label: string;
}

/**
 * One page, drawn straight onto its canvas when it comes near the visible part of the panel. All
 * thirty pages drawn at once, each turned into a PNG and decoded again, hold the window for up to
 * half a second on every row the selection moves to.
 */
const PdfPage = React.memo(({ pdf, number, width, ratio, label }: PdfPageProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [aspect, setAspect] = useState(ratio);
  const drawnWidth = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (near || !canvas) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setNear(true);
      observer.disconnect();
    }, { rootMargin: PAGE_DRAW_MARGIN });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !canvas || width <= 0) return undefined;
    let live = true;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    const draw = async () => {
      const page = await pdf.getPage(number);
      if (!live) return;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.max(1, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: (width * scale) / base.width });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      setAspect(base.height / base.width);
      task = page.render({ canvas, viewport });
      await task.promise;
      drawnWidth.current = width;
    };
    // The first drawing at once; a new width (the panel being dragged) once it holds still.
    const timer = setTimeout(() => { void draw().catch(() => undefined); }, drawnWidth.current ? RESIZE_SETTLE_MS : 0);
    return () => {
      live = false;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [near, pdf, number, width]);

  return <Box component="canvas" ref={canvasRef} role="img" aria-label={label} style={{ ...PAGE_STYLE, aspectRatio: `1 / ${aspect || 1}` }} />;
});
PdfPage.displayName = 'PdfPage';

interface KnowledgeFilePreviewProps {
  kbId: string;
  file: KnowledgeFile;
  /** The text the index read: what other types show, and a PDF that cannot be drawn. */
  text: string;
  width: number;
  t: (key: string) => string;
}

/** A file's read-only preview in its side panel, as a file manager's preview pane. */
export const KnowledgeFilePreview: React.FC<KnowledgeFilePreviewProps> = ({ kbId, file, text, width, t }) => {
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setPreview(undefined);
    const timer = setTimeout(() => {
      void knowledgeApi.filePreview(kbId, file.path).then((result) => { if (live) setPreview(result); }, () => { if (live) setPreview(null); });
    }, PREVIEW_SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [kbId, file.path, file.mtime]);
  const doc = usePdfDocument(preview?.kind === 'pdf' ? preview.data : null);

  if (preview === undefined) return <Loader size="sm" />;
  if (preview?.kind === 'image') {
    return <Image src={preview.dataUrl} alt={file.path} fit="contain" radius="sm" style={PAGE_STYLE} />;
  }
  if (preview?.kind === 'pdf' && !doc.failed) {
    if (!doc.pdf) return <Loader size="sm" />;
    const total = doc.pdf.numPages;
    return (
      <Stack gap={10}>
        {Array.from({ length: Math.min(total, PDF_PREVIEW_PAGES) }, (_, index) => (
          <PdfPage
            key={index}
            pdf={doc.pdf!}
            number={index + 1}
            width={width}
            ratio={doc.ratio}
            label={fillTemplate(t('kb.preview.page'), { page: String(index + 1) })}
          />
        ))}
        {total > PDF_PREVIEW_PAGES && (
          <Text fz="var(--font-size-sm)" c="var(--text-muted)">
            {fillTemplate(t('kb.preview.morePages'), { shown: String(PDF_PREVIEW_PAGES), total: String(total) })}
          </Text>
        )}
      </Stack>
    );
  }
  if (preview?.kind === 'tooLarge') {
    return <Text fz="var(--font-size-sm)" c="var(--text-muted)">{t('kb.preview.tooLarge')}</Text>;
  }
  // Documents, sheets, slides and text: the text the index read, read-only.
  return text ? (
    <Text fz="var(--font-size-sm)" c="var(--text-secondary)" style={TEXT_STYLE}>{text}</Text>
  ) : (
    <Text fz="var(--font-size-sm)" c="var(--text-muted)">{file.read === 'pending' ? t('kb.page.reading') : t('kb.preview.none')}</Text>
  );
};
