// src/preload/gemini.ts
//
// NOTE: This preload runs with contextIsolation: false so it executes in the
// same JS world as the page — that is what makes Object.defineProperty work.

Object.defineProperty(document, 'visibilityState', {
  get: () => 'visible',
  configurable: true,
});

Object.defineProperty(document, 'hidden', {
  get: () => false,
  configurable: true,
});

Object.defineProperty(document, 'hasFocus', {
  value: () => true,
  configurable: true,
  writable: true,
});

// Swallow visibilitychange so Gemini never receives a "hidden" transition
document.addEventListener(
  'visibilitychange',
  (e) => e.stopImmediatePropagation(),
  true,
);
