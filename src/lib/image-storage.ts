import path from 'path';
export const outputDir = path.resolve(/* turbopackIgnore: true */ process.env.IMAGE_STORAGE_DIR || path.join(process.cwd(), 'generated-images'));
