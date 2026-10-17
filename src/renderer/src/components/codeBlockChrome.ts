// Offsets of the controls over a code block or a Mermaid diagram: the language tag, the copy
// button and the diagram toolbar share one row. `side` is the code column's 1rem padding, so the
// tag lines up with the code text. No Mantine import: the export tree renders without a provider.
export const CODE_CHROME = { top: 8, side: 16, control: 26 } as const;
