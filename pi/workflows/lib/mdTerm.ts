// mdTerm — render the Markdown subset that LLM replies use into ANSI-styled
// terminal text. Zero dependencies; identity when the styler is disabled, so
// pipes and tests keep the raw Markdown.
//
// Handled: ATX headings, bold/italic, inline code, fenced code blocks, bullet
// and ordered lists, blockquotes, links, horizontal rules. Everything else
// (tables, setext headings, reference links) passes through inline-rendered.
// Deliberate omission: underscore-italic — snake_case identifiers would be
// mangled (`foo_bar_baz`).

import type { Styler } from "./ttyStyle.ts";

// One pass so inserted ANSI codes are never re-matched by later patterns.
const INLINE =
  /`([^`\n]+)`|\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*|\*(?!\s)([^*\n]+?)(?<!\s)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

function renderInline(text: string, s: Styler): string {
  return text.replace(INLINE, (_match, code, bold, italic, linkText, linkUrl) => {
    if (code !== undefined) return s.yellow(code);
    if (bold !== undefined) return s.bold(bold);
    if (italic !== undefined) return s.italic(italic);
    return linkText === linkUrl
      ? s.cyan(linkText)
      : `${s.cyan(linkText)} ${s.dim(`(${linkUrl})`)}`;
  });
}

/** Render Markdown for the terminal. Returns `text` unchanged when styling is off. */
export function renderMarkdown(text: string, s: Styler): string {
  if (!s.enabled) return text;
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence; // drop the fence markers, keep the content
      continue;
    }
    if (inFence) {
      out.push(s.yellow(line));
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const rendered = renderInline(heading[2], s);
      out.push(heading[1].length <= 2 ? s.bold(s.cyan(rendered)) : s.bold(rendered));
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(s.dim("───"));
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      out.push(s.dim(renderInline(quote[1], s)));
      continue;
    }
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) {
      out.push(`${bullet[1]}${s.cyan("•")} ${renderInline(bullet[2], s)}`);
      continue;
    }
    const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (ordered) {
      out.push(`${ordered[1]}${s.cyan(`${ordered[2]}.`)} ${renderInline(ordered[3], s)}`);
      continue;
    }
    out.push(renderInline(line, s));
  }
  return out.join("\n");
}
