import OpenCC from 'opencc-js/cn2t';

/**
 * Its own chunk: the OpenCC dictionaries are large and only an answer with Simplified Chinese in it
 * ever needs them. Reached only through `loadOpencc()` in openccRuntime.
 *
 * `twp`: Taiwan characters and Taiwan phrases (a mainland word becomes Taiwan's). Phrase
 * conversion is far from perfect, which is why the result is labelled a local conversion and can
 * be removed.
 */
export const convertCnToTaiwan: (text: string) => string = OpenCC.Converter({ from: 'cn', to: 'twp' });
