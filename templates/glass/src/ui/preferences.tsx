import { createContext, useContext, useState, type ReactNode } from "react";
import { Preferences } from "../domain/preferences.js";
const Context = createContext<{
  value: Preferences;
  set(value: Preferences): void;
  error: string;
}>({ value: Preferences.parse({}), set() {}, error: "" });
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [value, update] = useState<Preferences>(() => {
    try {
      return Preferences.parse(
        JSON.parse(localStorage.getItem("glass.preferences") ?? "{}"),
      );
    } catch {
      return Preferences.parse({});
    }
  });
  const [error, setError] = useState("");
  function set(next: Preferences) {
    update(next);
    try {
      localStorage.setItem("glass.preferences", JSON.stringify(next));
      setError("");
    } catch {
      setError("Preferences apply in this window, but could not be saved.");
    }
  }
  return (
    <Context.Provider value={{ value, set, error }}>
      {children}
    </Context.Provider>
  );
}
export const usePreferences = () => useContext(Context);
