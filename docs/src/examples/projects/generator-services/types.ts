export type Document = { title: string; body: string };
export type RenderedDocument = {
  format: 'html' | 'text';
  content: string;
  extension: 'html' | 'txt';
  mime: string;
};
