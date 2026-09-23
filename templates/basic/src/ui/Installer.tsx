/**
 * This harness's installer — `@lloyal-labs/ui`'s component with our register
 * bound, wrapped once so the rest of the app imports THIS one and never sees
 * the shared component's defaults.
 *
 * It shows only while something is being acquired, which is the first run and
 * no other. Loading weights already on disk is boot, and boot is the ordinary
 * app opening, not a screen.
 *
 * The steps come from `useInstall()` — the PLATFORM's stream, not this app's
 * fold — read in `App.tsx` where the layout decision is made. Nothing about
 * acquiring weights appears in `protocol.ts` or `state.ts`, so there is nothing
 * here to miswire or delete.
 *
 * The one thing the shared component cannot know is what "use a file I already
 * have" means, so this supplies it: the placement's file chooser (a desktop
 * shell has one; a browser cannot hand back a path), then the SAME command the
 * Settings tab sends for `model.path` — `applies: 'reload'`, so the runtime
 * restarts and resolves the file by possession instead of downloading.
 */
import type { CSSProperties, ReactElement } from "react";
import { Installer as UiInstaller } from "@lloyal-labs/ui";
import type { InstallerProps, InstallerStep } from "@lloyal-labs/ui";

const SERIF = '"Linux Libertine", Georgia, "Times New Roman", serif';

const REGISTER: InstallerProps["styles"] = {
  root: { boxSizing: "border-box", width: "100%", height: "100%", display: "flex", flexDirection: "column", margin: 0, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border-faint)" },
  title: { display: "flex", alignItems: "center", gap: 11, fontFamily: SERIF, fontSize: 20, fontWeight: 400 },
  counter: { fontSize: 12, color: "var(--faint)", letterSpacing: "0.02em" },
  bar: { height: "100%", background: "var(--link)", borderRadius: 999, transition: "width .25s linear" },
  figures: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" },
  footnote: { marginLeft: "auto", fontSize: 12, color: "var(--faint)" },
  list: { flexGrow: 1, padding: "14px 22px", display: "flex", flexDirection: "column", borderTop: "1px solid var(--border-faint)" },
  label: { flexGrow: 1, fontSize: 14.5 },
  note: { fontSize: 12, color: "var(--muted)" },
  link: { background: "none", border: 0, padding: 0, margin: 0, cursor: "pointer", fontSize: 12.5, color: "var(--link)", textDecoration: "underline", textUnderlineOffset: 2 },
};

/** The card is `ui`'s; WHERE it sits is ours. The installer is the whole window
 *  until it is done, so it gets the window: the app's own ground behind, and the
 *  card flexing to fill it inside a gutter rather than capped at a column
 *  width — a step list reads better wide than boxed. */
const PAGE: CSSProperties = {
  height: "100vh",
  background: "var(--panel)",
  display: "flex",
  padding: 32,
  boxSizing: "border-box",
};

export function Installer({ steps }: { steps: readonly InstallerStep[] }): ReactElement {
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
                window.harness.send({ type: "reload_runtime", patch: { model: { path: picked } } });
              });
            }
          : undefined
      }
    />
    </div>
  );
}
