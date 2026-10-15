import { MicGlyph, RecordingWaveform } from "@lloyal-labs/ui";
import { ActivityLabel } from "./ActivityLabel.js";
import type { VoiceInput } from "@lloyal-labs/ui";
export function VoiceButton({ voice }: { voice: VoiceInput }) {
  if (voice.enabled === false) return null;
  return (
    <button
      type="button"
      className="gc-icon"
      aria-label="Dictate"
      title="Dictate"
      disabled={!voice.available}
      onClick={voice.start}
    >
      <MicGlyph />
    </button>
  );
}
export function VoiceCapture({ voice }: { voice: VoiceInput }) {
  return (
    <div className="gc-record" role="group" aria-label="Voice input">
      <RecordingWaveform
        levels={voice.levels}
        elapsed={voice.elapsed}
        recording={voice.phase === "recording"}
      />
      {voice.phase !== "recording" && (
        <ActivityLabel active>Transcribing…</ActivityLabel>
      )}
      {voice.phase === "recording" && (
        <button type="button" className="gc-small" onClick={voice.stop}>
          Done
        </button>
      )}
      <button type="button" className="gc-small" onClick={voice.cancel}>
        Cancel
      </button>
    </div>
  );
}
