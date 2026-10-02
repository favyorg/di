import { Tag } from '../../../../../di/src';
import type { Document, RenderedDocument } from './types';

export const Formatter = Tag<{
  Render(document: Document): RenderedDocument;
}>()('Formatter');
export type FormatterLive = typeof Formatter.Live;
