/** The esbuild `--loader:.eta=text` semantics, as a Node loader hook — what
 *  lets the rig run the REAL pipeline (which imports its prompts as text)
 *  under tsx instead of requiring an esbuild bundle per test run. */
import { readFile } from "node:fs/promises";

export async function load(url, context, nextLoad) {
  if (url.endsWith(".eta")) {
    const source = await readFile(new URL(url), "utf8");
    return { format: "module", shortCircuit: true, source: `export default ${JSON.stringify(source)};` };
  }
  return nextLoad(url, context);
}
