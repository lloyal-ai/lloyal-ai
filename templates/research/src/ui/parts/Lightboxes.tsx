/** The app's one enlarged view, held above everything a run redraws: a follow-up that settles, the canvas turning
 *  from writing to settled, a section as it streams. Whatever opens an image, a document or a video asks for it here
 *  (`useLightbox`), and it stays open until the reader closes it. An open video holds the run whenever the run works,
 *  opened during it or started under, until it closes; until the hold takes it waits, said over its poster
 *  (`viewing.ts` holds the rules). */
import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Lightbox, useHarness, useProjection, useSend } from "@lloyal-labs/ui";
import type { Command, WorkflowEvent } from "../../protocol.js";
import type { AppState } from "../state.js";
import { selectControls, selectLive } from "../select.js";
import { closing, covered, holding, opening, type Opened, type RunFacts, type Viewing } from "../viewing.js";
import { WAITING_FOR_THE_RUN } from "../presentation.js";
import { color, font, radius } from "../theme.js";

const selectRunFacts = (app: AppState): RunFacts => ({ live: selectLive(app), paused: selectControls(app).paused });

const Open = createContext<((opened: Opened) => void) | null>(null);

export function Lightboxes({ children }: { children: ReactNode }): ReactElement {
  const send = useSend<Command>();
  const { projection } = useHarness<WorkflowEvent, Command, AppState>();
  const run = useProjection(selectRunFacts);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  // Stable, so the prose that calls it keeps its memo: the run is read as it stands at the click.
  const open = useCallback((opened: Opened): void => {
    const { viewing, command } = opening(opened, selectRunFacts(projection.getSnapshot()));
    if (command) send(command);
    setViewing(viewing);
  }, [projection, send]);
  // A run that starts working under an open video, plan review's countdown say, is held by it then.
  useEffect(() => {
    if (!viewing) return;
    const { viewing: held, command } = holding(viewing, run);
    if (!command) return;
    send(command);
    setViewing(held);
  }, [viewing, run, send]);
  const close = (): void => {
    const command = viewing && closing(viewing);
    if (command) send(command);
    setViewing(null);
  };
  return (
    <Open.Provider value={open}>
      {children}
      {viewing && (
        <Lightbox
          {...viewing.opened}
          {...(covered(viewing, run) ? { waiting: WAITING_FOR_THE_RUN } : {})}
          onClose={close}
          styles={LIGHTBOX}
        />
      )}
    </Open.Provider>
  );
}

/** Open an image, a document or a video in the app's one enlarged view. */
export function useLightbox(): (opened: Opened) => void {
  const open = useContext(Open);
  if (!open) throw new Error("useLightbox: no <Lightboxes> above this component");
  return open;
}

/** The enlarged view in this document's register. */
const LIGHTBOX = {
  full: { maxWidth: "100%", maxHeight: "calc(100vh - 110px)", objectFit: "contain", borderRadius: radius.panel, background: color.card } as CSSProperties,
  pdf: { width: "min(1100px, 94vw)", height: "calc(100vh - 110px)", border: 0, borderRadius: radius.panel, background: "#fff" } as CSSProperties,
  caption: { font: `12px ${font.ui}`, color: "#D8D8D2", margin: 0 } as CSSProperties,
};
