import { Block, CodeBlock, parseProps } from "codehike/blocks"
import { Pre, highlight, type HighlightedCode, type RawCode } from "codehike/code"
import { z } from "zod"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useEffect, useRef, useState } from "react"
import { tokenTransitions } from "./tokenTransitions"

const Schema = Block.extend({ tabs: z.array(CodeBlock) })
export function CodeWithTabs(props: unknown) {
  const { tabs } = parseProps(props, Schema);

  return <CodeTabs tabs={tabs} />
}

export function CodeTabs({ tabs }: { tabs: RawCode[] }) {
  const [highlighted, setHighlighted] = useState<HighlightedCode[]>([]);
  const [currentTab, setCurrentTab] = useState(0);
  const interval = useRef<NodeJS.Timeout>();
  const theme = document.documentElement.dataset['theme'];

  useEffect(() => {
    const codeTheme = theme === 'dark' ? "github-dark" : "github-light";

    Promise.all(
      tabs.map((tab) => highlight(tab, codeTheme)),
    ).then(setHighlighted);

    clearInterval(interval.current);
    interval.current = setInterval(() => {
      setCurrentTab(currentTab => (currentTab + 1) % tabs.length);
    }, 4000);
  }, [tabs])

  return highlighted.length ? (
    <Tabs defaultValue={"compare.ts"} className={`${theme} rounded not-content`}>
      <TabsList className="rounded-none">
        <TabsTrigger key={1} value={"compare.ts"}>
            compare.ts
        </TabsTrigger>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.meta} value={tab.meta}>
            {tab.meta}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent key={1} value={"compare.ts"} className="mt-0">
          <Pre code={highlighted[currentTab]} className="m-0 rounded-none" handlers={[tokenTransitions]} />
      </TabsContent>
      {tabs.map((tab, i) => (
        <TabsContent key={tab.meta} value={tab.meta} className="mt-0">
          <Pre code={highlighted[i]} className="m-0 rounded-none" handlers={[tokenTransitions]} />
        </TabsContent>
      ))}
    </Tabs>
  ) : <div>...</div>
}
