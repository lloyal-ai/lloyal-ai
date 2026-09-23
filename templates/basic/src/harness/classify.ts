/**
 * Which saved articles belong together, and what to call each pile. One agent reads them all and names the
 * topics; then every article's own agent files it under one, by number.
 */
import type { Operation } from "effection";
import { agent, agentPool, parallel } from "@lloyal-labs/lloyal-agents";
import { defineOutput } from "@lloyal-labs/rig";
import { z } from "zod";
import { prompt, render } from "./prompts.js";
import type { Saved } from "./article.js";
import type { Group } from "../protocol.js";

export function* classifyTopics(kept: Saved[]): Operation<Group[]> {
  const listings = kept.map(listing);
  const topics = yield* nameTopics(listings);
  if (topics.length === 0) return [];
  const picks = yield* fileUnder(topics, listings);
  return pilesOf(topics, kept, picks);
}

/** How much of an article the model reads beside its question — enough to say what a follow-up was about. */
const OPENING = 400;

/** An article as the model is shown it: by number, never by folder name, so its `docId` stays here. */
interface Listing {
  n: number;
  query: string;
  opening: string;
}

const listing = (article: Saved, i: number): Listing =>
  ({ n: i + 1, query: article.query, opening: article.answer.slice(0, OPENING) });

/** How the model hands in the topics it sees across the whole shelf: their names. */
const named = defineOutput("topics", z.object({ topics: z.array(z.string()) }));

/** One agent reads every article, so all of them are filed against one set of names. */
function* nameTopics(listings: Listing[]): Operation<string[]> {
  const namer = yield* agent({
    ...prompt("topics", { articles: listings, smallestPile: SMALLEST_PILE, tool: named.tool.name }),
    terminal: named.tool,
    enableThinking: false,
  });
  return named.read(namer)?.topics ?? [];
}

/** Each article's own agent answers with its topic's number, 0 for none. They fork from one spine that lists
 *  the topics, and decode together — the number is the whole answer, so nothing reasons before it and it is
 *  kept as the agent's result. An article whose agent answered nothing is left unfiled. */
function* fileUnder(topics: string[], listings: Listing[]): Operation<(number | null)[]> {
  const pick = defineOutput("topic", z.number().int().min(0).max(topics.length));
  const pool = yield* agentPool({
    systemPrompt: render("topic.system", { topics }),
    schema: pick.schema,
    enableThinking: false,
    acceptFreeText: true,
    orchestrate: parallel(listings.map((article) => ({ systemPrompt: "", content: render("topic.user", { article }) }))),
  });
  return pool.outcomes.map((outcome) => pick.read(outcome));
}

/** The fewest articles that make a topic worth showing. */
const SMALLEST_PILE = 2;

/** A pile is the articles filed under its number. A topic with fewer than `SMALLEST_PILE` is not a pile: its
 *  articles stay on the flat list. */
const pilesOf = (topics: string[], kept: Saved[], picks: (number | null)[]): Group[] =>
  topics
    .map((topic, t) => ({ topic, docIds: kept.filter((_, i) => picks[i] === t + 1).map((article) => article.docId) }))
    .filter((pile) => pile.docIds.length >= SMALLEST_PILE);
