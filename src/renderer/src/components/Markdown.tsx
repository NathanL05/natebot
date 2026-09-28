import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { Element, ElementContent, Root, RootContent } from 'hast'
import { api } from '../lib/store'

const MARK = /([✓✔✗✘])/

/** Wraps ✓ / ✗ characters in spans so the checklist marks get colour. */
function rehypeChecks() {
  const walk = (node: Root | Element): void => {
    const out: (RootContent | ElementContent)[] = []
    for (const child of node.children) {
      if (child.type === 'text' && MARK.test(child.value)) {
        for (const part of child.value.split(MARK)) {
          if (!part) continue
          if (MARK.test(part)) {
            out.push({
              type: 'element',
              tagName: 'span',
              properties: { className: [part === '✓' || part === '✔' ? 'check' : 'cross'] },
              children: [{ type: 'text', value: part }]
            })
          } else {
            out.push({ type: 'text', value: part })
          }
        }
      } else {
        if (child.type === 'element' && child.tagName !== 'code' && child.tagName !== 'pre') walk(child)
        out.push(child)
      }
    }
    node.children = out as typeof node.children
  }
  return (tree: Root) => walk(tree)
}

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (href) void api.openExternal(href)
      }}
    >
      {children}
    </a>
  )
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeChecks]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
