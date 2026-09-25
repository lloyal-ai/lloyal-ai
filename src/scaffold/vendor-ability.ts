/**
 * Verify a signed HDK ability and materialize it as a LOCAL `file:` tarball
 * dependency — the shared primitive behind `lloyal install` (add-on abilities)
 * and `lloyal new` (a template's default ability).
 *
 * **Why not `npm install <url>`.** npm 12 (default since 2026) refuses to
 * resolve a dependency from a remote URL/HTTPS tarball unless `--allow-remote`
 * is passed — the supply-chain hardening that followed the PhantomRaven RDD
 * campaign. Our whole ability channel is "HTTPS tarballs from apps.lloyal.ai", so a
 * raw `npm install <tarballUrl>` is blocked. Instead the CLI does the fetch +
 * **Ed25519 verify** itself, writes the verified bytes into the project's
 * `vendor/` dir, and points `package.json` at them with a `file:` spec. npm then
 * only ever installs a LOCAL dependency — out of scope of npm 12's remote block
 * (`--allow-file`/`--allow-directory` keep permissive defaults) — and `npm ci`
 * reproduces it offline from the committed tarball. The Ed25519 signature is the
 * sole trust gate; npm's transport trust never enters the picture.
 *
 * The signed manifest sidecar is written next to the tarball so the bytes stay
 * re-verifiable offline (the manifest carries the signature + publisherKeyId,
 * which the catalog version entry does not).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readPackageJson, writeJson } from './package-json.js';
import type { PackageJson } from './package-json.js';
import {
  fetchAndVerifyCatalog,
  resolveAbilityVersion,
  fetchAndVerifyManifest,
  verifyBundle,
  sha512Integrity,
  BundleVerificationError,
  type AbilityBundleManifest,
} from '../verify.js';
import { readTarEntry, isGzipReadable } from '../tar-read.js';
import type { AttentionSurface } from '../describe.js';
import { httpFetch } from '../http.js';
import { derivesFromLlm, isService, modelsForRole } from './model-catalog.js';
import type { Service } from './model-catalog.js';
import { modelSelection } from './model-selection.js';

/**
 * Spec grammar: `<publisher>/<name>[@<semver>]` (post-W) or back-compat
 * `<name>[@<semver>]` (lloyal-internal pre-W entries, which never reached
 * external publish). Both segments of the scoped form match the ability/handle
 * grammar `[a-z][a-z0-9_-]{1,63}`.
 */
export const SCOPED_NAME_PATTERN = /^[a-z][a-z0-9_-]{1,63}\/[a-z][a-z0-9_-]{1,63}$/;
export const UNSCOPED_NAME_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;

export interface AppSpec {
  /** Catalog identifier — `<publisher>/<name>` (or a bare pre-W `<name>`). */
  name: string;
  /** Optional semver range; `undefined` selects the highest published version. */
  semver: string | undefined;
}

export class InvalidAppSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAppSpecError';
  }
}

/**
 * Parse + validate `<publisher>/<name>[@<semver>]`. Scoped names contain `/`
 * but never `@`, so the first `@` (if any) is unambiguously the semver
 * delimiter. Throws {@link InvalidAppSpecError} on a malformed name.
 */
export function parseAbilitySpec(spec: string): AppSpec {
  const atIdx = spec.indexOf('@');
  const name = atIdx === -1 ? spec : spec.slice(0, atIdx);
  const semver = atIdx === -1 ? undefined : spec.slice(atIdx + 1);
  if (!SCOPED_NAME_PATTERN.test(name) && !UNSCOPED_NAME_PATTERN.test(name)) {
    throw new InvalidAppSpecError(
      `invalid ability name "${name}" — expected \`<publisher>/<short-name>\` ` +
        '(e.g., `lloyal/web`, `acme/jira`).',
    );
  }
  return { name, semver };
}

/**
 * Flatten a scoped catalog name like `lloyal/web` to `lloyal__web` for use in a
 * filesystem path. Mirrors the R2 channel encoding the Worker writes on approval.
 */
export function flatEncodeScopedName(name: string): string {
  return name.replace('/', '__');
}

export interface VendoredApp {
  /** The catalog identifier that was vendored (`<publisher>/<name>`). */
  name: string;
  /** npm package name — the `import` symbol + the `package.json` dep key. */
  importName: string;
  /** Resolved version. */
  version: string;
  /** Project-relative, forward-slash `file:` target (e.g. `vendor/lloyal__web-1.0.0.tgz`). */
  vendorRelPath: string;
  /** `sha512-<base64>` over the verified tarball bytes. */
  integrity: string;
}

/** A service an ability requires that the project selects no model for — with the line that would: the
 *  catalog's id under `model.<service>.id`, or, for a service whose provider derives the model from the llm,
 *  the empty block `model.<service>: {}`. */
export interface MissingService {
  ability: string;
  service: Service;
  /** `model.<service>.id`, or `model.<service>` when the remedy is the block itself. */
  key: string;
  suggestion?: string;
  /** The remedy is the empty block: the provider pairs the model from the llm. */
  block?: true;
}

/** An ability's requirement this project cannot meet, or a name no runtime provides. Nothing was vendored. */
export class RequirementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequirementError';
  }
}

export interface VendorOptions {
  /**
   * Print the ability's attention-surface disclosure (what it injects into the
   * model's context) to stdout. Default `true` for the explicit `install`
   * command; the scaffolder passes `false` to keep `new` output terse.
   */
  disclose?: boolean;
  /**
   * How a requirement the project does not meet is settled — the one place the CLI may write `harness.yml`
   * for an install: asked, never unasked. Answers true once the block is written, false to leave the file as
   * it is. Absent — a pipe, `new -y` — there is nobody to ask, and the requirement refuses the install.
   */
  settle?: (missing: MissingService) => Promise<boolean>;
}

/** What the ability requires, read off its own `ability.json` in the verified bytes. A requirement the gate
 *  cannot read — a package it cannot open, one that carries no manifest, a manifest that does not parse — is a
 *  refusal, never "requires nothing": an ability that would install cleanly and never enable is the failure
 *  the gate exists to stop. */
export async function requiredServicesOf(tarball: Uint8Array, ability: string): Promise<readonly string[]> {
  const raw = await readTarEntry(tarball, 'package/ability.json');
  if (raw === null) {
    throw new RequirementError(
      isGzipReadable(tarball)
        ? `${ability}'s package carries no ability.json, so what it requires is unknown. Nothing was installed.`
        : `${ability}'s package could not be opened (not a gzip stream, or larger than the inspect cap), so what it requires is unknown. Nothing was installed.`,
    );
  }
  let manifest: { services?: unknown };
  try {
    manifest = JSON.parse(raw) as { services?: unknown };
  } catch {
    throw new RequirementError(`${ability}'s ability.json does not parse, so what it requires is unknown. Nothing was installed.`);
  }
  // Omitted is "requires nothing". Present, it must be a list of names — anything else is a declaration the
  // gate cannot read, and a requirement it cannot read is never "none".
  const { services } = manifest;
  if (services === undefined) return [];
  if (!Array.isArray(services) || !services.every((s): s is string => typeof s === 'string')) {
    throw new RequirementError(`${ability}'s ability.json declares \`services\` as ${JSON.stringify(services)}; it must be a list of service names. Nothing was installed.`);
  }
  return services;
}

/**
 * Can this project select every service this ability requires? Asked of the RESOLVED configuration — the
 * local overlay over the manifest — since that is what the boot acts on. Every name is checked against the
 * platform before any is offered, so a list with one unknown name is refused outright with nothing written.
 * A block that selects a model, or that the platform derives from the llm, is a request the boot will settle;
 * a block that is absent, or present and naming nothing where nothing derives, is offered to `settle` with the
 * key it lacks, and refused when nobody can answer.
 */
export async function assertRequirements(projectDir: string, ability: string, required: readonly string[], settle?: VendorOptions['settle']): Promise<void> {
  const names: Service[] = [];
  for (const name of required) {
    if (!isService(name)) {
      throw new RequirementError(`${ability} requires ${JSON.stringify(name)}, which is not a service this platform provides. Nothing was installed.`);
    }
    names.push(name);
  }
  for (const name of names) {
    const selection = modelSelection(projectDir, name);
    const derives = derivesFromLlm(name);
    if (selection.present && (selection.spec !== null || derives)) continue;
    const suggestion = derives ? undefined : modelsForRole(name)[0]?.id;
    const missing: MissingService = derives
      ? { ability, service: name, key: `model.${name}`, block: true }
      : { ability, service: name, key: `model.${name}.id`, ...(suggestion ? { suggestion } : {}) };
    if (settle && (await settle(missing))) continue;
    const how = derives ? ` (\`model.${name}: {}\` takes the one paired with your model)` : suggestion ? ` (\`${missing.key}: ${suggestion}\` is the catalog's)` : '';
    throw new RequirementError(
      (selection.present
        ? `${ability} requires \`${name}\`, and this project's \`model.${name}\` names no model — add \`${missing.key}\` to harness.yml`
        : `${ability} requires \`${name}\`, and this project names none — add \`model.${name}\` to harness.yml`) +
        how + `, then \`lloyal install ${ability}\`. Nothing was installed.`,
    );
  }
}

/**
 * Fetch → Ed25519-verify → vendor a signed ability into `<projectDir>/vendor/` and
 * point `package.json` at it with a `file:` dependency. FATAL on any verify or
 * write failure — the vendored bytes become the source of truth, so there is no
 * silent fallback to a remote fetch. Returns the resolved coordinates.
 *
 * Mirrors `lloyal install`'s verify chain step-for-step; the ONLY
 * difference from the old flow is the final materialization (local `file:` dep
 * instead of `npm install <remote-url>`).
 */
export async function verifyAndVendorAbility(
  projectDir: string,
  spec: AppSpec,
  opts: VendorOptions = {},
): Promise<VendoredApp> {
  // 1-2. Catalog → version entry (Ed25519-verified catalog; pure resolve).
  const catalog = await fetchAndVerifyCatalog();
  const entry = resolveAbilityVersion(catalog, spec.name, { semver: spec.semver });

  // 3. Manifest fetch + cross-check (name/version/sizeBytes vs the catalog).
  const { manifest, trustKey } = await fetchAndVerifyManifest(entry, spec.name);

  // 4. Tarball fetch + Ed25519 verify over the raw bytes.
  const response = await httpFetch(entry.tarballUrl);
  if (!response.ok) {
    throw new BundleVerificationError(
      `Tarball fetch from ${entry.tarballUrl} returned HTTP ${response.status} ${response.statusText}.`,
    );
  }
  const tarball = new Uint8Array(await response.arrayBuffer());
  if (tarball.byteLength !== manifest.sizeBytes) {
    throw new BundleVerificationError(
      `Tarball size ${tarball.byteLength} does not match manifest.sizeBytes ${manifest.sizeBytes}.`,
    );
  }
  const ok = await verifyBundle(tarball, manifest.signature, trustKey);
  if (!ok) {
    throw new BundleVerificationError(
      `Ed25519 signature verification failed for ${spec.name}@${manifest.version} ` +
        `(publisherKeyId="${manifest.publisherKeyId}").`,
    );
  }

  // 5. Integrity cross-check: the sha512 we compute over the received bytes must
  // equal the signed manifest.integrity. The Ed25519 signature is the real trust
  // gate; this guards against a signing-pipeline bug emitting an integrity that
  // doesn't match what was signed.
  const integrity = await sha512Integrity(tarball);
  if (manifest.integrity !== integrity) {
    throw new BundleVerificationError(
      `manifest integrity ${manifest.integrity} does not match sha512 of received ` +
        `tarball bytes ${integrity}. This indicates a signing-pipeline bug — file an ` +
        `issue at https://github.com/lloyal-ai/lloyal-ai.`,
    );
  }

  // 5b. Best-effort disclosure of what the ability injects into the model's context,
  // read from the ALREADY-VERIFIED bytes. Never blocks the vendor.
  if (opts.disclose !== false) {
    try {
      await renderAttentionSurface(tarball, spec.name);
    } catch {
      // disclosure is advisory; a parse/read failure must not fail the install
    }
  }

  // 5c. Every write prepared before any mutation: the project must be one (a `package.json` the `file:` dep can
  // land in) and must provide what the ability requires — an ability whose service the configuration never
  // selects would install cleanly and never enable. The offer to write `harness.yml` comes after the
  // `package.json` check, so a project that is not a project is refused with nothing touched.
  const pkgPath = join(projectDir, 'package.json');
  const pkg = projectPackageJson(pkgPath, projectDir);
  await assertRequirements(projectDir, spec.name, await requiredServicesOf(tarball, spec.name), opts.settle);

  // 6. Write the verified tarball + its signed manifest sidecar into vendor/.
  // The sidecar keeps the bytes re-verifiable offline (signature + keyId live in
  // the manifest, not in the catalog version entry).
  const base = `${flatEncodeScopedName(spec.name)}-${manifest.version}`;
  const vendorRelPath = `vendor/${base}.tgz`;
  const vendorDir = join(projectDir, 'vendor');
  await mkdir(vendorDir, { recursive: true });
  await writeFile(join(vendorDir, `${base}.tgz`), tarball);
  await writeFile(
    join(vendorDir, `${base}.manifest.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  // 7. Point package.json at the local tarball (npm 12 installs `file:` deps
  // without --allow-remote; `npm ci` reproduces it offline from the committed
  // tarball) — through the one owner of the file.
  pkg.dependencies = { ...(pkg.dependencies ?? {}), [entry.importName]: `file:${vendorRelPath}` };
  writeJson(pkgPath, pkg)();

  return {
    name: spec.name,
    importName: entry.importName,
    version: manifest.version,
    vendorRelPath,
    integrity,
  };
}

/** The project's `package.json`, read and shape-checked before anything is written — vendoring only makes sense
 *  inside a project, and a missing file says so by name. */
function projectPackageJson(pkgPath: string, projectDir: string): PackageJson {
  try {
    return readPackageJson(pkgPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`no package.json in ${projectDir} — run this inside a harness project.`);
    }
    throw err;
  }
}

/**
 * Print the ability's attention surface — exactly what it injects into the model's
 * context — read from the Ed25519-verified tarball bytes. Best-effort: a parse
 * failure or a pre-feature ability degrades to a one-line note.
 */
export async function renderAttentionSurface(tarball: Uint8Array, name: string): Promise<void> {
  const raw = await readTarEntry(tarball, 'package/attention-surface.json');
  if (raw === null) {
    // null = absent OR unreadable tarball. The bytes are Ed25519-verified, so
    // corruption is near-impossible; the real residual case is a package whose
    // decompressed size exceeds the inspect cap. Say which, honestly.
    const note = isGzipReadable(tarball)
      ? `${name} ships no attention-surface.json (published before context disclosure).`
      : `${name}'s package could not be read to disclose its attention surface (it exceeds the inspect cap or is corrupt).`;
    process.stdout.write(`\n  note: ${note}\n`);
    return;
  }
  let s: AttentionSurface;
  try {
    s = JSON.parse(raw) as AttentionSurface;
  } catch {
    process.stdout.write(`\n  note: ${name}'s attention surface could not be parsed.\n`);
    return;
  }
  process.stdout.write(formatAttentionSurface(s, name));
}

/**
 * Build the human-readable attention-surface disclosure. PURE + TOTAL: the input
 * is signed-for-authenticity but NOT shape-validated publisher JSON, so every
 * field is coerced/guarded — a malformed `tools`/`skill`/`configSchema` degrades
 * just that line, never throws. Exported for unit testing of the malformed-input
 * paths.
 */
export function formatAttentionSurface(s: AttentionSurface, name: string): string {
  const lines: string[] = [`\nWhat ${name} adds to your model's context:`];
  if (typeof s.protocol?.name === 'string') lines.push(`  protocol:  ${s.protocol.name}`);
  if (typeof s.protocol?.useWhen === 'string') lines.push(`  use when:  ${s.protocol.useWhen}`);

  const tools = (Array.isArray(s.tools) ? s.tools : []).filter(
    (t): t is NonNullable<typeof t> => !!t && typeof t === 'object',
  );
  lines.push(`\n  Tools (${tools.length}):`);
  for (const t of tools) {
    const nm = typeof t.name === 'string' && t.name ? t.name : '(unnamed)';
    // `protected` means the tool requires a session grant (authGuard/GrantStore)
    // to be callable — it is about consent, NOT about whether the tool mutates.
    const tag = t.protected === true ? '  [needs grant]' : '';
    const desc = typeof t.description === 'string' && t.description ? ` — ${t.description}` : '';
    lines.push(`    • ${nm}${desc}${tag}`);
  }
  if (s.degraded) lines.push('    (tool descriptions unavailable for this version)');

  const props = (s.configSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
  const keys = props && typeof props === 'object' ? Object.keys(props) : [];
  if (keys.length) {
    lines.push('\n  Config it reads:');
    for (const k of keys) {
      const p = props![k] as { type?: unknown; 'x-secret'?: unknown } | null | undefined;
      const secret = p && typeof p === 'object' && p['x-secret'] ? ', secret' : '';
      const ty = p && typeof p === 'object' && typeof p.type === 'string' ? p.type : 'value';
      lines.push(`    • ${k} (${ty}${secret})`);
    }
  }

  if (typeof s.skill === 'string' && s.skill) {
    const all = s.skill.split('\n');
    const shown = all.slice(0, 10);
    lines.push('\n  System-prompt skill (per turn):');
    for (const l of shown) lines.push(`    | ${l}`);
    if (all.length > shown.length) lines.push(`    | … (${all.length - shown.length} more lines)`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export type { AbilityBundleManifest };
