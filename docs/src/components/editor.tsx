import { useEffect, useId, useMemo, useState } from 'react';
import { TypeScriptEditor } from './typescript-editor';

export function Editor({ code }: { code: string }) {
  const editorId = useId();
  const [value, setValue] = useState(code);
  const modelPath = useMemo(
    () => `file:///docs/example-${encodeURIComponent(editorId)}.ts`,
    [editorId]
  );

  useEffect(() => {
    setValue(code);
  }, [code]);

  const fallback = (
    <pre
      aria-label="TypeScript example"
      style={{ maxWidth: '100%', overflowX: 'auto' }}
    >
      <code>{code}</code>
    </pre>
  );

  return (
    <TypeScriptEditor
      value={value}
      onChange={setValue}
      height={code.split('\n').length * 27}
      modelPath={modelPath}
      ariaLabel="TypeScript example"
      fallback={fallback}
    />
  );
}
