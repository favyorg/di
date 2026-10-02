import { GenModule } from '../../../../../di/src';
import { Formatter } from './contracts';
import type { Document } from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const HtmlFormatter = GenModule()(Formatter, function* () {
  return {
    Render({ title, body }: Document) {
      const paragraphs = body
        .split(/\n\s*\n/)
        .map(
          (paragraph) =>
            `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`
        );
      return {
        format: 'html' as const,
        content: [`<h1>${escapeHtml(title)}</h1>`, ...paragraphs].join('\n'),
        extension: 'html' as const,
        mime: 'text/html',
      };
    },
  };
});
export type HtmlFormatterLive = typeof HtmlFormatter.Live;

export const PlainTextFormatter = GenModule()(Formatter, function* () {
  return {
    Render({ title, body }: Document) {
      return {
        format: 'text' as const,
        content: `${title}\n${'='.repeat(title.length)}\n\n${body}`,
        extension: 'txt' as const,
        mime: 'text/plain',
      };
    },
  };
});
export type PlainTextFormatterLive = typeof PlainTextFormatter.Live;
