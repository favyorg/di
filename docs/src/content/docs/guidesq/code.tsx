'use client';
import {
  highlight,
  type RawCode,
  type HighlightedCode,
  Pre,
} from 'codehike/code';
import { tokenTransitions } from './tokenTransitions';
import { createRef, useEffect, useRef, useState } from 'react';

export function Code({ blocks, time }: { blocks: string[]; time: number }) {
  const [highlighted, setHighlighted] = useState<HighlightedCode>();
  const interval = useRef<NodeJS.Timer>();

  useEffect(() => {
    let blockIndex = 0;
    const run = () => {
      highlight(
        {
          lang: 'ts',
          meta: '',
          value: blocks[Math.floor(blockIndex % blocks.length)],
        },
        'github-dark'
      ).then(setHighlighted);

      blockIndex++;
    };

    run();
    // @ts-expect-error
    clearTimeout(interval.current);
    interval.current = setInterval(run, time);
  }, [blocks, time]);

  console.log(blocks);

  return (
    <span className="not-content">
      {highlighted && <Pre code={highlighted} handlers={[tokenTransitions]} />}
    </span>
  );
}
