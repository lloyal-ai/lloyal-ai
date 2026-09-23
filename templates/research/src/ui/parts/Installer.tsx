/**
 * This harness's installer — `@lloyal-labs/ui`'s component with our register
 * bound, wrapped once the way {@link Lightbox} is in `Figures.tsx`, so the rest
 * of the view imports THIS one and never sees the shared defaults.
 *
 * It shows only while something is being acquired, which is the first run and no
 * other. Loading weights already on disk is boot — the `AvailabilityBanner` in
 * `Shell.tsx` says "Starting your session…" for that, from the platform's own
 * `warming` — and boot is the app opening, not a screen.
 *
 * The steps come from `useInstall()`: the PLATFORM's stream, never this app's
 * fold. Nothing about acquiring weights is declared in `protocol.ts` or
 * `reduce.ts`, so there is nothing here to miswire or delete.
 *
 * The one thing the shared component cannot know is what "use a file I already
 * have" means, so this supplies it: the placement's file chooser (a desktop
 * shell has one; a browser cannot hand back a path), then the SAME command the
 * Settings tab sends for `model.path` — declared `applies: 'reload'`, so the
 * runtime restarts and resolves the file by possession instead of downloading.
 */
import type { CSSProperties, ReactElement } from "react";
import { Installer as UiInstaller, useSend } from "@lloyal-labs/ui";
import type { InstallerProps, InstallerStep } from "@lloyal-labs/ui";
import { color, font, radius } from "../theme.js";
import type { Command } from "../../protocol.js";

const REGISTER: InstallerProps["styles"] = {
  root: { boxSizing: "border-box", width: "100%", height: "100%", display: "flex", flexDirection: "column", margin: 0, background: color.card, color: color.ink, border: `1px solid ${color.line}`, borderRadius: radius.panel, fontFamily: font.ui },
  title: { display: "flex", alignItems: "center", gap: 11, fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" },
  counter: { fontFamily: font.mono, fontSize: 12, color: color.faint, letterSpacing: "0.02em" },
  track: { height: 5, background: color.card2, borderRadius: radius.pill, overflow: "hidden" },
  bar: { height: "100%", background: color.ember, borderRadius: radius.pill, transition: "width .25s linear" },
  figures: { display: "flex", alignItems: "center", gap: 8, fontFamily: font.mono, fontSize: 12, color: color.dim },
  footnote: { marginLeft: "auto", fontFamily: font.mono, fontSize: 12, color: color.dim },
  list: { flexGrow: 1, padding: "14px 22px", display: "flex", flexDirection: "column", borderTop: `1px solid ${color.line}` },
  rowActive: { background: color.card2, borderRadius: radius.control },
  label: { flexGrow: 1, fontSize: 14.5 },
  note: { fontFamily: font.mono, fontSize: 12, color: color.dim },
  failure: { margin: "4px 24px 0", padding: "16px 18px", background: color.emberWash, border: `1px solid ${color.line}`, borderRadius: radius.card, fontSize: 13.5, lineHeight: 1.55, color: color.ink, whiteSpace: "pre-line" },
  button: { background: color.ink, border: `1px solid ${color.ink}`, borderRadius: radius.control, padding: "8px 15px", cursor: "pointer", fontFamily: font.ui, fontSize: 13, fontWeight: 500, color: color.card },
  link: { background: "none", border: 0, padding: 0, margin: 0, cursor: "pointer", fontFamily: font.ui, fontSize: 12.5, color: color.emberDeep, textDecoration: "underline", textUnderlineOffset: 2 },
};

/** The card is `ui`'s; WHERE it sits is ours. The installer is the whole window
 *  until it is done, so it gets the window: the app's own ground behind, and the
 *  card flexing to fill it inside a gutter rather than capped at a column. */
const PAGE: CSSProperties = {
  height: "100vh",
  background: color.ground,
  display: "flex",
  padding: 32,
  boxSizing: "border-box",
};

export function Installer({ steps }: { steps: readonly InstallerStep[] }): ReactElement {
  const send = useSend<Command>();
  const choose = window.harness.chooseFile;
  return (
    <div style={PAGE}>
    <UiInstaller
      steps={steps}
      footnote="First run only"
      styles={REGISTER}
      onUseLocalFile={
        choose
          ? (): void => {
              void choose({ extensions: ["gguf"], title: "Choose a .gguf model" }).then((picked) => {
                if (!picked) return;
                // `model.path` outranks the catalog id, so the next boot resolves
                // this file and fetches nothing. One pipeline, chosen differently.
                send({ type: "reload_runtime", patch: { model: { path: picked } } });
              });
            }
          : undefined
      }
    />
    </div>
  );
}
