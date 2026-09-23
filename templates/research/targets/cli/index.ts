/**
 * The CLI target — your harness in a terminal, or as the engine a desktop
 * shell forks. Everything below the seam is rig's `bootEdge`: the models, the
 * resident context, the abilities' services, the Runner, the binding the
 * environment picks. What this file adds is the terminal view.
 */
import { bootEdge } from "@lloyal-labs/rig/node";
import { harness, abilities, config, services } from "../../src/app.js";
import { renderCli } from "../../src/ui/cli.js";

bootEdge({ harness, abilities, config, services }, { render: renderCli });
