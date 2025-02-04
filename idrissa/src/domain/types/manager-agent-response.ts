import { z } from "zod";
import { ManagerAgentActionSchema } from "./manager-agent-action.js";
import { zodToJsonSchema } from "zod-to-json-schema";

export const ManagerAgentResponseSchema = z.object({
  currentState: z.object({
    evaluationPreviousGoal: z.string(),
    memory: z.string(),
    nextGoal: z.string(),
  }),
  actions: z.array(ManagerAgentActionSchema),
});

export type ManagerResponse = z.infer<typeof ManagerAgentResponseSchema>;

export const JsonifiedManagerResponseSchema = JSON.stringify(
  zodToJsonSchema(ManagerAgentResponseSchema, "ExpectedResponseFormat"),
);

export const ManagerResponseExamples = `

Example Response 1:
{
  "currentState": {
    "evaluationPreviousGoal": "Cookies have been accepted. We can now proceed to login.",
    "memory": "Cookies accepted, ready to login. End goal is to login to my account.",
    "nextGoal": "Display the login form.",
  },
  "actions": [{"name": "clickElement", "params": {"index": 3}}]
}

Example Response 2:
{
  "currentState": {
    "evaluationPreviousGoal": "An element seems to prevent us from logging in. We need close the cookies popup.",
    "memory": "Our end goal is to login to my account. We need to close the cookies popup and then we can proceed to login.",
    "nextGoal": "Close cookies popup and then login.",
  },
  "actions": [{"name": "clickElement", "params": {"index": 5}}]
}

Example Response 3:
{
  "currentState": {
    "evaluationPreviousGoal": "We need to scroll down to find the login form.",
    "memory": "We need to scroll down to find the login form. End goal is to login to my account.",
    "nextGoal": "Scroll down to find the login form."
  },
  "actions": [{"name": "scrollDown"}]
}
`;
