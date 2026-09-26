/**
 * The CLI target — your harness in a terminal, or as the engine a desktop shell
 * forks. Everything below the seam is rig's `bootEdge`: the layered config, the
 * model resolved (fetched + digest-verified on first run, no API key), the
 * resident context, the abilities' services, the trace sink, the Runner, and the
 * binding the environment picks — Ink on a TTY, the process channel when a
 * desktop shell forked this bin, JSON lines on a pipe.
 *
 * What this file adds is the terminal view.
 */
import { bootEdge } from "@lloyal-labs/rig/node";
import { harness, abilities, config } from "../../src/app.js";
import { renderCli } from "../../src/ui/cli.js";

bootEdge({ harness, abilities, config }, { render: renderCli });
