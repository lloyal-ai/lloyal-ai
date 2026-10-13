import { usePreferences } from "../preferences.js";
export function PreferencesView() {
  const { value, set, error } = usePreferences();
  return (
    <details className="glass-preferences">
      <summary>Preferences</summary>
      <label>
        Answer detail
        <select
          value={value.detail}
          onChange={(e) =>
            set({ ...value, detail: e.target.value as typeof value.detail })
          }
        >
          <option value="adaptive">Fit the request</option>
          <option value="brief">Concise</option>
          <option value="thorough">Detailed</option>
        </select>
      </label>
      <label>
        Work surfaces
        <select
          value={value.work}
          onChange={(e) =>
            set({ ...value, work: e.target.value as typeof value.work })
          }
        >
          <option value="auto">As needed</option>
          <option value="expanded">Expanded</option>
          <option value="compact">Compact</option>
        </select>
      </label>
      <label>
        Motion
        <select
          value={value.motion}
          onChange={(e) =>
            set({ ...value, motion: e.target.value as typeof value.motion })
          }
        >
          <option value="system">Use system setting</option>
          <option value="reduced">Reduce motion</option>
        </select>
      </label>
      <small>
        Saved on this browser. Your next request can override answer detail.
      </small>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
