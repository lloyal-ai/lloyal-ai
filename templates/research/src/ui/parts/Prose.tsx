/** The brief's prose — markdown from the harness, its citations already
 *  inline (rig weaves each report's sources into its text as it is captured), set in the document's one face; links open outward. Carries
 *  the document's whole type system: the model's own headings step DOWN
 *  from the document title (size and spacing make the hierarchy; weight
 *  never exceeds 600 — emphasis included, so a bold-happy model can't
 *  shout), links whisper under a hairline, quotes and code sit in the
 *  register. With an `anchorPrefix`, headings carry the ids `anchorsOf`
 *  derives — the same pure list the outline rail reads, indexed in render
 *  order. With `citations` (url → ordinal), a cited link grows its chip;
 *  a link whose whole text is a bare "[1]" collapses into the chip. */
import { createContext, memo, useContext, useMemo, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Markdown, momentClock, useAssets, useContentOrigin, videoView } from "@lloyal-labs/ui";
import { splitStreaming } from "@lloyal-labs/ui/prose";
import type { Anchor } from "@lloyal-labs/ui/prose";
import { color, font, radius } from "../theme.js";
import { anchorsOf, isBareOrdinal, selectThreadDigestKey } from "../select.js";
import { useProjection } from "@lloyal-labs/ui";
import { parseAttachmentHref, parseAttachmentMoment, resolvePrefix } from "@lloyal-labs/media";
import { textOf } from "../text-of.js";
import { useLightbox } from "./Lightboxes.js";

/** The heading scale, stepping down from the document's 31px title. */
const HEADING: Record<"h1" | "h2" | "h3" | "h4", CSSProperties> = {
  h1: { font: `600 21px/1.3 ${font.ui}`, letterSpacing: "-.014em", margin: "30px 0 10px", textWrap: "balance" },
  h2: { font: `600 18px/1.35 ${font.ui}`, letterSpacing: "-.012em", margin: "26px 0 8px", textWrap: "balance" },
  h3: { font: `600 16px/1.4 ${font.ui}`, letterSpacing: "-.008em", margin: "20px 0 6px" },
  h4: { font: `600 14px/1.4 ${font.ui}`, margin: "16px 0 5px" },
};

/** Models sometimes wrap a woven link in literal brackets — shed them. */
const shed = (raw: string): string => raw.replace(/\[(\[[^\]]*\]\([^)]*\))\]/g, "$1");

/** Whether what is rendering sits inside a link. A code span there is the link's label, not a citation of its
 *  own: the link is already the control, and a button inside a button is not markup a page may have. */
const InsideLink = createContext(false);

/** Memoized on its props: a section keeps its parse while a sibling streams.
 *  Headings take their ids from `anchors` when given, else from `anchorPrefix`
 *  over this text alone. */
export const Prose = memo(function Prose({ markdown: raw, anchorPrefix, anchors: given, citations }: {
  markdown: string;
  anchorPrefix?: string;
  anchors?: Anchor[];
  citations?: Map<string, number>;
}): ReactElement {
  // A cited page opens where it is cited. The thread's roots are what an
  // `attachment://` prefix may resolve to; the sidecar says which page root
  // stands for the page. Subscribed as a KEY: the memo above only holds if
  // nothing inside re-renders this on folds that changed no prop of its own.
  const digestKey = useProjection(selectThreadDigestKey);
  const digests = useMemo(() => (digestKey ? digestKey.split("\n") : []), [digestKey]);
  const assets = useAssets(digests);
  const open = useLightbox();
  const origin = useContentOrigin();
  const markdown = shed(raw);
  const anchors = given ?? (anchorPrefix ? anchorsOf(markdown, anchorPrefix) : []);
  let next = 0;
  /** Text that is exactly an attachment address: a model citing a moment or a page in backticks, or as the bare
   *  address, rather than as a link with words of its own. The address is unambiguous either way, so it reads as
   *  the citation it is, shown as its moment or its page rather than as the address. */
  const citedAddress = (children: ReactNode): ReactElement | null => {
    const text = textOf(children).trim();
    const moment = parseAttachmentMoment(text);
    const page = moment ? null : parseAttachmentHref(text);
    if (moment) return linked({ href: text });
    if (page) return linked({ href: text, children: `page ${page.page}` });
    return null;
  };
  /** An inline code span: a citation when its text is an attachment address, unless a link already holds it. */
  const InlineCode = ({ children }: { children?: ReactNode }): ReactElement =>
    (useContext(InsideLink) ? null : citedAddress(children)) ?? <code style={S.code}>{children}</code>;
  /** A link, and the fact of being inside one for whatever it renders. A link whose words are its own address
   *  (a bare address in the prose) reads as that address cited. */
  const link = (props: { href?: string; children?: ReactNode }): ReactElement => (
    <InsideLink.Provider value={true}>
      {(textOf(props.children).trim() === props.href ? citedAddress(props.children) : null) ?? linked(props)}
    </InsideLink.Provider>
  );
  const linked = ({ href, children }: { href?: string; children?: ReactNode }): ReactElement => {
    const ordinal = href ? citations?.get(href) : undefined;
    const moment = href ? parseAttachmentMoment(href) : null;
    if (moment) {
      // A moment in a video: the one root that answers to the prefix, played from that time.
      const root = resolvePrefix(moment.prefix, digests);
      const asset = root ? assets[root] : undefined;
      const at = momentClock(moment.tMs);
      const mark = <>{children}{ordinal !== undefined && <sup style={S.cite}>{ordinal}</sup>}</>;
      if (!root || asset?.kind !== "video" || origin === null) {
        // Not playable here (yet): the citation stays visible, as its own words or, from backticks, its address.
        const shown = children ?? <code style={S.code}>{href}</code>;
        return <span style={S.citeLink} title={`video · ${at} — not in this thread`}>{shown}{ordinal !== undefined && <sup style={S.cite}>{ordinal}</sup>}</span>;
      }
      const view = videoView(origin, root, asset, moment.tMs);
      // The frame the model saw at that moment: the last one shown at or before it.
      const seen = view.frames.filter((f) => f.tMs <= moment.tMs).at(-1) ?? view.frames[0];
      // Said aloud as it reads: the cited words, their citation number, then what pressing it does.
      const label = [textOf(children).trim(), ordinal !== undefined && `citation ${ordinal}`, `play the attached video from ${at}`]
        .filter(Boolean).join(", ");
      return (
        <button type="button" style={S.pageLink} title={`video · ${at} — play from here`} aria-label={label} onClick={() => open({ video: view, label: "the attached video" })}>
          {mark}
          <span style={S.moment}>
            {seen && <img src={seen.src} alt="" style={S.momentFrame} />}
            <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4v16l14-8z" /></svg>
            {at}
          </span>
        </button>
      );
    }
    const cited = href ? parseAttachmentHref(href) : null;
    if (cited) {
      // Evidence by content address: exactly one root in this thread
      // answers to the prefix, and its sidecar names the page's render.
      const root = resolvePrefix(cited.prefix, digests);
      const asset = root ? assets[root] : undefined;
      const meta = asset?.kind === "document" ? asset.meta : null;
      const render = meta?.pages.find((p) => p.page === cited.page)?.render;
      const mark = <>{children}{ordinal !== undefined && <sup style={S.cite}>{ordinal}</sup>}</>;
      if (!render || !meta) {
        return <span style={S.citeLink} title={meta ? `${meta.title} · page ${cited.page}` : "page not in this thread"}>{mark}</span>;
      }
      return (
        <button
          type="button"
          style={S.pageLink}
          title={`${meta.title} · page ${cited.page} — open`}
          onClick={() => open({ digest: render.digest, label: `${meta.title} · page ${cited.page}` })}
        >
          {mark}
        </button>
      );
    }
    if (ordinal === undefined) {
      return (
        <a href={href} target="_blank" rel="noreferrer" style={S.link}>
          {children}
        </a>
      );
    }
    const bare = isBareOrdinal(textOf(children));
    // A corpus citation's target is a local file — chip without a
    // dead hyperlink; the sources grid carries its card.
    if (!/^https?:\/\//.test(href ?? "")) {
      return (
        <span style={S.citeLink}>
          {!bare && children}
          <sup style={S.cite}>{ordinal}</sup>
        </span>
      );
    }
    return (
      <a href={href} target="_blank" rel="noreferrer" style={S.citeLink}>
        {!bare && children}
        <sup style={S.cite}>{ordinal}</sup>
      </a>
    );
  };

  const anchored = (Tag: "h1" | "h2" | "h3" | "h4") =>
    ({ children }: { children?: ReactNode }): ReactElement =>
      <Tag id={anchors[next++]?.anchor} style={HEADING[Tag]}>{children}</Tag>;
  return (
    <Markdown
      markdown={markdown}
      style={S.prose}
      components={{
        a: link,
        h1: anchored("h1"), h2: anchored("h2"), h3: anchored("h3"), h4: anchored("h4"),
        p: ({ children }) => <p style={S.p}>{children}</p>,
        strong: ({ children }) => <strong style={S.strong}>{children}</strong>,
        blockquote: ({ children }) => <blockquote style={S.quote}>{children}</blockquote>,
        code: ({ children, className }) =>
          className ? (
            <code className={className} style={S.codeBlock}>{children}</code>
          ) : (
            <InlineCode>{children}</InlineCode>
          ),
        pre: ({ children }) => <pre style={S.pre}>{children}</pre>,
      }}
    />
  );
});

/** Prose still being written. The finished blocks keep their parse — the
 *  head only changes when a block completes, so its `Prose` is skipped by
 *  the memo — and only the block under the caret is parsed per token.
 *  Heading ids are counted over the whole text: the tail's anchors are the
 *  document's minus the head's, which agree left to right. */
export function StreamingProse({ markdown: raw, anchorPrefix, citations }: {
  markdown: string;
  anchorPrefix?: string;
  citations?: Map<string, number>;
}): ReactElement {
  const { head, tail } = splitStreaming(shed(raw));
  const headAnchors = useMemo(
    () => (anchorPrefix ? anchorsOf(head, anchorPrefix) : []),
    [head, anchorPrefix],
  );
  const tailAnchors = anchorPrefix ? anchorsOf(head + tail, anchorPrefix).slice(headAnchors.length) : [];
  return (
    <>
      {head && <Prose markdown={head} anchors={headAnchors} citations={citations} />}
      <Prose markdown={tail} anchors={tailAnchors} citations={citations} />
    </>
  );
}

const S: Record<string, CSSProperties> = {
  prose: { font: `400 15.5px/1.72 ${font.ui}`, color: color.ink },
  p: { margin: "0 0 14px" },
  // Emphasis, not shouting — a bold-happy model still reads as prose.
  strong: { fontWeight: 600 },
  // Links whisper: a hairline under the words, the words keep the accent.
  link: {
    color: color.emberDeep, textDecoration: "underline", textDecorationThickness: 1,
    textDecorationColor: "#E4B7A8", textUnderlineOffset: 3,
  },
  citeLink: { textDecoration: "none", color: "inherit" },
  // A cited page is a button in link's clothing: it opens the page here.
  pageLink: {
    background: "none", border: 0, padding: 0, margin: 0, font: "inherit", color: "inherit",
    textDecoration: "underline dotted", textUnderlineOffset: 3, cursor: "zoom-in",
  },
  // A cited moment, as a shared video's timestamp: the frame, a play mark, the time.
  moment: {
    display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 4, padding: "1px 6px 1px 2px", verticalAlign: "middle",
    font: `600 11px/1 ${font.mono}`, color: color.emberDeep, background: color.emberWash, borderRadius: radius.pill,
  },
  momentFrame: { height: 14, aspectRatio: "16 / 9", objectFit: "cover", borderRadius: radius.pill, display: "block" },
  cite: {
    font: `600 10px/1 ${font.ui}`, color: color.emberDeep, background: color.emberWash,
    borderRadius: radius.pill, padding: "2px 5px", marginLeft: 2, verticalAlign: "super",
  },
  quote: {
    margin: "0 0 14px", padding: "2px 0 2px 14px",
    borderLeft: `3px solid ${color.line}`, color: color.dim, fontStyle: "italic",
  },
  code: {
    font: `13px ${font.mono}`, background: color.card2, borderRadius: 5,
    padding: "1px 5px",
  },
  codeBlock: { font: `12.5px/1.6 ${font.mono}`, background: "none", padding: 0 },
  pre: {
    margin: "0 0 14px", padding: "12px 14px", background: color.card2,
    border: `1px solid ${color.line}`, borderRadius: radius.card, overflowX: "auto",
  },
};
