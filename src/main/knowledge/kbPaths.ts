/**
 * Where the knowledge bases keep their indexes (`<userData>/knowledge/<id>.sqlite`), apart from the
 * store so start-up code (factory reset) can name the folder without loading node:sqlite.
 */
export const KB_DIR_NAME = 'knowledge';
