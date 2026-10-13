import { useEffect, useReducer } from "react";
import { Text, Box, render, useInput } from "ink";
import { TextInput } from "@inkjs/ui";
import type { EventBus } from "@lloyal-labs/binding";
import type { Command, WorkflowEvent } from "../protocol.js";
import { initialState, reduce } from "./state.js";
import { activeConversation, isWorking, streamedAnswer } from "./select.js";

function View({
  bus,
  dispatch,
  bootstrap,
}: {
  bus: EventBus<WorkflowEvent>;
  dispatch(c: Command): void;
  bootstrap: readonly WorkflowEvent[];
}) {
  const [state, apply] = useReducer(reduce, bootstrap, (events) =>
    events.reduce(reduce, initialState),
  );
  useEffect(() => bus.subscribe(apply), [bus]);
  useInput((input, key) => {
    if (key.ctrl && input === "c")
      dispatch({ type: isWorking(state) ? "stop" : "quit" });
  });
  const record = activeConversation(state);
  const answer = record?.turns.at(-1)?.answer ?? streamedAnswer(state);
  return (
    <Box flexDirection="column" gap={1}>
      <Text>Glass</Text>
      {state.error && <Text color="red">{state.error}</Text>}
      {answer && <Text>{answer}</Text>}
      {isWorking(state) ? (
        <Text dimColor>{state.work?.phase} · Ctrl-C to stop</Text>
      ) : (
        <TextInput
          placeholder="What’s on your mind?"
          onSubmit={(query) =>
            dispatch({
              type: "submit_query",
              query,
              conversationId: state.activeId,
              revision: record?.revision,
            })
          }
        />
      )}
    </Box>
  );
}
export function renderCli(
  bus: EventBus<WorkflowEvent>,
  dispatch: (c: Command) => void,
  bootstrap: readonly WorkflowEvent[],
  streams: { stdin?: NodeJS.ReadStream; stdout?: NodeJS.WriteStream } = {},
): () => void {
  const instance = render(
    <View bus={bus} dispatch={dispatch} bootstrap={bootstrap} />,
    { ...streams, exitOnCtrlC: false },
  );
  return () => instance.unmount();
}
