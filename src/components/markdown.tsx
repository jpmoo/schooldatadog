import { type ReactNode } from "react";

// A small, dependency-free markdown renderer for Scout's chat replies. It covers
// the "basic" markdown the model actually uses — headings, bold/italic, inline
// code, links, code blocks, and bullet/numbered lists — and renders to React
// nodes (never raw HTML), so model output can't inject markup.

const CODE = "rounded bg-black/10 px-1 py-0.5 font-mono text-[0.85em] dark:bg-white/10";

/** Parse inline markup (code, bold, italic, links, line breaks) into nodes. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf) out.push(buf);
    buf = "";
  };
  while (i < text.length) {
    const rest = text.slice(i);
    let m: RegExpExecArray | null;
    if (text[i] === "\n") {
      flush();
      out.push(<br key={out.length} />);
      i += 1;
    } else if ((m = /^`([^`]+)`/.exec(rest))) {
      flush();
      out.push(
        <code key={out.length} className={CODE}>
          {m[1]}
        </code>,
      );
      i += m[0].length;
    } else if ((m = /^(\*\*|__)(.+?)\1/.exec(rest))) {
      flush();
      out.push(<strong key={out.length}>{inline(m[2])}</strong>);
      i += m[0].length;
    } else if ((m = /^\*([^*\n]+?)\*/.exec(rest))) {
      flush();
      out.push(<em key={out.length}>{m[1]}</em>);
      i += m[0].length;
    } else if (
      (i === 0 || /[^A-Za-z0-9]/.test(text[i - 1])) &&
      // underscore italics only at word boundaries, so snake_case isn't mangled
      (m = /^_([^_\n]+?)_(?![A-Za-z0-9])/.exec(rest))
    ) {
      flush();
      out.push(<em key={out.length}>{m[1]}</em>);
      i += m[0].length;
    } else if ((m = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(rest))) {
      flush();
      out.push(
        <a
          key={out.length}
          href={m[2]}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {m[1]}
        </a>,
      );
      i += m[0].length;
    } else {
      buf += text[i];
      i += 1;
    }
  }
  flush();
  return out;
}

const isBullet = (l: string) => /^\s*[-*]\s+/.test(l);
const isNumbered = (l: string) => /^\s*\d+\.\s+/.test(l);
const isSpecial = (l: string) => /^```|^#{1,6}\s/.test(l) || isBullet(l) || isNumbered(l);

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i += 1; // closing fence
      blocks.push(
        <pre key={blocks.length} className="overflow-x-auto rounded bg-black/10 p-2 dark:bg-white/10">
          <code className="font-mono text-xs">{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={blocks.length} className="font-semibold">
          {inline(heading[2])}
        </p>,
      );
      i += 1;
      continue;
    }

    if (isBullet(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isBullet(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>);
        i += 1;
      }
      blocks.push(
        <ul key={blocks.length} className="list-disc space-y-0.5 pl-5">
          {items}
        </ul>,
      );
      continue;
    }

    if (isNumbered(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isNumbered(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>);
        i += 1;
      }
      blocks.push(
        <ol key={blocks.length} className="list-decimal space-y-0.5 pl-5">
          {items}
        </ol>,
      );
      continue;
    }

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !isSpecial(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={blocks.length}>{inline(para.join("\n"))}</p>);
  }

  return <div className="space-y-1.5 whitespace-normal">{blocks}</div>;
}
